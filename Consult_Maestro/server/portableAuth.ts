import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

const getOidcConfig = memoize(
  async () => {
    const issuerUrl = process.env.ISSUER_URL;
    const clientId = process.env.OIDC_CLIENT_ID;
    const clientSecret = process.env.OIDC_CLIENT_SECRET;

    if (!issuerUrl || !clientId) {
      console.warn("OIDC not configured: missing ISSUER_URL or OIDC_CLIENT_ID");
      return null;
    }

    return await client.discovery(
      new URL(issuerUrl),
      clientId,
      clientSecret
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "lax" : "lax",
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertOidcUser(claims: any) {
  return await storage.upsertOidcUser({
    providerSub: claims["sub"],
    email: claims["email"],
    firstName: claims["given_name"] || claims["first_name"] || claims["name"]?.split(" ")[0],
    lastName: claims["family_name"] || claims["last_name"] || claims["name"]?.split(" ").slice(1).join(" "),
    profileImageUrl: claims["picture"] || claims["profile_image_url"],
    provider: "oidc",
  });
}

function getCallbackUrl(): string {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
  const callbackPath = process.env.OIDC_CALLBACK_PATH || "/api/callback";
  return `${baseUrl}${callbackPath}`;
}

function getPostLogoutRedirectUri(): string {
  return process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  if (config) {
    const verify: VerifyFunction = async (
      tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
      verified: passport.AuthenticateCallback
    ) => {
      try {
        const user = {};
        updateUserSession(user, tokens);
        const dbUser = await upsertOidcUser(tokens.claims());
        (user as any).dbUserId = dbUser.id;
        verified(null, user);
      } catch (error) {
        console.error("OIDC verify error:", error);
        verified(error as Error);
      }
    };

    const scopes = process.env.OIDC_SCOPES || "openid email profile";

    const strategy = new Strategy(
      {
        name: "oidc",
        config,
        scope: scopes,
        callbackURL: getCallbackUrl(),
      },
      verify
    );
    passport.use(strategy);

    app.get("/api/login/oidc", (req, res, next) => {
      passport.authenticate("oidc", {
        prompt: "login",
        scope: scopes.split(" "),
      })(req, res, next);
    });

    app.get("/api/callback", (req, res, next) => {
      passport.authenticate("oidc", {
        successReturnToOrRedirect: "/",
        failureRedirect: "/login?error=auth_failed",
      })(req, res, next);
    });

    app.post("/api/logout", (req, res) => {
      const user = req.user as any;
      const isOidcUser = user && !user.isLocalAuth;

      req.logout(() => {
        req.session.destroy(() => {
          if (isOidcUser && config) {
            try {
              const endSessionUrl = client.buildEndSessionUrl(config, {
                client_id: process.env.OIDC_CLIENT_ID!,
                post_logout_redirect_uri: getPostLogoutRedirectUri(),
              });
              return res.json({ 
                success: true, 
                logoutUrl: endSessionUrl.href,
                message: "Logout realizado com sucesso" 
              });
            } catch (error) {
              console.error("Error building end session URL:", error);
            }
          }
          res.json({ success: true, message: "Logout realizado com sucesso" });
        });
      });
    });
  } else {
    app.get("/api/login/oidc", (req, res) => {
      res.status(503).json({ 
        message: "OIDC authentication not configured. Use local login." 
      });
    });

    app.post("/api/logout", (req, res) => {
      req.logout(() => {
        req.session.destroy(() => {
          res.json({ success: true, message: "Logout realizado com sucesso" });
        });
      });
    });
  }

  app.get("/api/auth/me", async (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    const user = req.user as any;
    let dbUser;

    if (user.isLocalAuth) {
      dbUser = await storage.getUser(user.id);
    } else if (user.claims?.sub) {
      dbUser = await storage.getUser(user.claims.sub);
      if (!dbUser) {
        dbUser = await storage.getUserByProviderSub(user.claims.sub);
      }
    } else if (user.dbUserId) {
      dbUser = await storage.getUser(user.dbUserId);
    }

    if (!dbUser) {
      return res.status(401).json({ message: "User not found" });
    }

    res.json({
      id: dbUser.id,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      role: dbUser.role,
      profileImageUrl: dbUser.profileImageUrl,
      isLocalAuth: dbUser.isLocalAuth === 1,
      provider: dbUser.provider,
    });
  });

  app.get("/api/auth/config", (req, res) => {
    res.json({
      oidcEnabled: !!config,
      localEnabled: true,
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.isLocalAuth) {
    return next();
  }

  if (!user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const config = await getOidcConfig();
    if (!config) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Unauthorized" });
  }
};
