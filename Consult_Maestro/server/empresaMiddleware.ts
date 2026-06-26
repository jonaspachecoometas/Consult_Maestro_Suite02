import { Request, Response, NextFunction } from 'express';

export function empresaMiddleware(
  req: Request, _res: Response, next: NextFunction
) {
  (req as any).activeEmpresaId = req.headers['x-empresa-id'] as string | undefined;
  (req as any).activeGrupoId  = req.headers['x-grupo-id']  as string | undefined;
  next();
}
