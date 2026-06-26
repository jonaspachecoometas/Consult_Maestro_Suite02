import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, FileType2 } from "lucide-react";

interface DocField {
  fieldname?: string;
  label?: string;
  fieldtype?: string;
  reqd?: 0 | 1 | boolean;
  options?: string;
  description?: string;
  default?: any;
  read_only?: 0 | 1 | boolean;
}

interface DocType {
  name?: string;
  module?: string;
  doctype?: string;
  fields?: DocField[];
  istable?: 0 | 1 | boolean;
}

interface Props {
  rawJson: string;
  fileName: string;
}

function safeParse(raw: string): { ok: true; doc: DocType } | { ok: false; error: string } {
  try {
    const obj = JSON.parse(raw);
    return { ok: true, doc: obj };
  } catch (e: any) {
    return { ok: false, error: e?.message || "JSON inválido" };
  }
}

function fieldLabel(f: DocField): string {
  return f.label || f.fieldname || "(sem label)";
}

function isRequired(f: DocField): boolean {
  return f.reqd === 1 || f.reqd === true;
}

function isReadOnly(f: DocField): boolean {
  return f.read_only === 1 || f.read_only === true;
}

const inputBase =
  "w-full px-2.5 py-1.5 text-sm rounded border border-input bg-background " +
  "focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/30 " +
  "disabled:opacity-60 disabled:bg-muted/30";

function FieldRenderer({ field }: { field: DocField }) {
  const ft = (field.fieldtype || "Data").toLowerCase();
  const disabled = isReadOnly(field);
  const placeholder = field.description || "";

  if (ft === "select") {
    const opts = (field.options || "").split("\n").map((s) => s.trim()).filter(Boolean);
    return (
      <select className={inputBase} disabled={disabled} defaultValue={field.default || ""} data-testid={`preview-select-${field.fieldname}`}>
        <option value="">— selecione —</option>
        {opts.map((o, i) => (
          <option key={i} value={o}>{o}</option>
        ))}
      </select>
    );
  }

  if (ft === "link") {
    return (
      <div className="relative">
        <input
          type="text"
          className={inputBase + " pr-8"}
          disabled={disabled}
          placeholder={`Buscar ${field.options || "registro"}…`}
          data-testid={`preview-link-${field.fieldname}`}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground bg-muted px-1 rounded">
          → {field.options || "?"}
        </span>
      </div>
    );
  }

  if (ft === "text" || ft === "long text" || ft === "small text" || ft === "text editor" || ft === "code") {
    return (
      <textarea
        className={inputBase + " resize-y min-h-[60px] font-mono text-xs"}
        disabled={disabled}
        placeholder={placeholder}
        data-testid={`preview-textarea-${field.fieldname}`}
      />
    );
  }

  if (ft === "check") {
    return (
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" disabled={disabled} defaultChecked={!!field.default} data-testid={`preview-check-${field.fieldname}`} />
        <span className="text-xs text-muted-foreground">Sim / Não</span>
      </label>
    );
  }

  if (ft === "date") {
    return <input type="date" className={inputBase} disabled={disabled} data-testid={`preview-date-${field.fieldname}`} />;
  }

  if (ft === "datetime") {
    return <input type="datetime-local" className={inputBase} disabled={disabled} data-testid={`preview-datetime-${field.fieldname}`} />;
  }

  if (ft === "time") {
    return <input type="time" className={inputBase} disabled={disabled} data-testid={`preview-time-${field.fieldname}`} />;
  }

  if (ft === "int" || ft === "float" || ft === "currency" || ft === "percent") {
    return (
      <input
        type="number"
        className={inputBase}
        disabled={disabled}
        placeholder={ft === "currency" ? "R$ 0,00" : "0"}
        data-testid={`preview-number-${field.fieldname}`}
      />
    );
  }

  if (ft === "attach" || ft === "attach image") {
    return (
      <div className="flex items-center gap-2">
        <button
          disabled
          className="px-3 py-1.5 rounded border border-dashed border-input text-xs text-muted-foreground bg-muted/20 cursor-not-allowed"
          data-testid={`preview-attach-${field.fieldname}`}
        >
          📎 Anexar arquivo
        </button>
        <span className="text-[10px] text-muted-foreground">(visual)</span>
      </div>
    );
  }

  if (ft === "table" || ft === "table multiselect") {
    return (
      <div className="border rounded-md overflow-hidden">
        <div className="bg-muted/40 px-2 py-1.5 text-[11px] font-medium border-b">
          Tabela filha — {field.options || "child doctype"}
        </div>
        <table className="w-full text-xs">
          <thead className="bg-muted/20">
            <tr>
              <th className="px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">#</th>
              <th className="px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">Coluna 1</th>
              <th className="px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">Coluna 2</th>
              <th className="px-2 py-1 text-left text-[10px] font-normal text-muted-foreground">Coluna 3</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={4} className="px-2 py-3 text-center text-[11px] text-muted-foreground italic">
                Sem linhas — clique em "Adicionar" no Frappe
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  if (ft === "section break" || ft === "column break" || ft === "tab break") {
    return null;
  }

  // Default: Data, HTML, Read Only, etc.
  return (
    <input
      type="text"
      className={inputBase}
      disabled={disabled}
      placeholder={placeholder}
      defaultValue={field.default || ""}
      data-testid={`preview-input-${field.fieldname}`}
    />
  );
}

export default function DocTypePreview({ rawJson, fileName }: Props) {
  const parsed = useMemo(() => safeParse(rawJson), [rawJson]);

  if (!parsed.ok) {
    return (
      <Card data-testid="preview-doctype-error">
        <CardContent className="pt-6 flex items-start gap-3 text-sm">
          <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Não foi possível renderizar o preview</p>
            <p className="text-xs text-muted-foreground mt-1">
              O arquivo <code>{fileName}</code> não é um JSON válido: {parsed.error}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const doc = parsed.doc;
  const fields = Array.isArray(doc.fields) ? doc.fields : [];
  const visibleFields = fields.filter((f) => {
    const ft = (f.fieldtype || "").toLowerCase();
    return ft !== "section break" && ft !== "column break" && ft !== "tab break";
  });

  return (
    <div className="space-y-3" data-testid="preview-doctype">
      {/* Header tipo Frappe */}
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <FileType2 className="h-4 w-4 text-blue-600" />
          <h3 className="text-sm font-semibold" data-testid="text-doctype-name">{doc.name || "DocType sem nome"}</h3>
          {doc.module && <Badge variant="outline" className="text-[10px]">{doc.module}</Badge>}
          {(doc.istable === 1 || doc.istable === true) && <Badge variant="secondary" className="text-[10px]">child table</Badge>}
        </div>
        <p className="text-[10px] text-muted-foreground">{visibleFields.length} campo(s)</p>
      </div>

      {visibleFields.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">DocType sem campos definidos.</p>
      )}

      {/* Form com aparência Frappe */}
      <ScrollArea className="max-h-[480px] pr-2">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-3">
          {visibleFields.map((f, i) => {
            const ft = (f.fieldtype || "").toLowerCase();
            const fullWidth = ["text", "long text", "small text", "text editor", "code", "table", "table multiselect"].includes(ft);
            return (
              <div key={i} className={fullWidth ? "md:col-span-2" : ""} data-testid={`field-${f.fieldname || i}`}>
                <label className="block text-[11px] font-medium text-foreground mb-1">
                  {fieldLabel(f)}
                  {isRequired(f) && <span className="text-destructive ml-0.5">*</span>}
                  <span className="ml-2 text-[9px] text-muted-foreground font-normal uppercase">{f.fieldtype}</span>
                </label>
                <FieldRenderer field={f} />
                {f.description && (
                  <p className="text-[10px] text-muted-foreground mt-1">{f.description}</p>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      <p className="text-[10px] text-muted-foreground text-center italic pt-2 border-t">
        Preview visual aproximado · A renderização final no ERPNext pode variar conforme tema e permissões.
      </p>
    </div>
  );
}
