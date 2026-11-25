import type { InputHTMLAttributes } from 'react';

export function Field({ label, hint, ...props }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...props} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function ErrorMsg({ error }: { error: string | null }) {
  return error ? <p className="error" role="alert">{error}</p> : null;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : 'Ocurrió un error.';
}

/** Campo numérico decimal (acepta coma). Devuelve el texto; la conversión la hace units.ts. */
export function NumField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <label className="field grow">
      <span>{props.label}</span>
      <input
        inputMode="decimal"
        value={props.value}
        placeholder={props.placeholder}
        required={props.required}
        onChange={(e) => props.onChange(e.target.value.replace(/[^0-9.,]/g, ''))}
      />
      {props.hint && <small className="muted">{props.hint}</small>}
    </label>
  );
}
