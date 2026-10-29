import type { ReactNode } from "react";

export function Champ(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  requis?: boolean;
  aide?: string;
  large?: boolean;
  autoComplete?: string;
}) {
  return (
    <label className={`champ${props.large ? " champ--large" : ""}`}>
      <span className="champ__label">
        {props.label}
        {props.requis && <span className="requis"> *</span>}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        autoComplete={props.autoComplete ?? "off"}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.aide && <span className="champ__aide">{props.aide}</span>}
    </label>
  );
}

export function Zone(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  lignes?: number;
}) {
  return (
    <label className="champ champ--large">
      <span className="champ__label">{props.label}</span>
      <textarea
        rows={props.lignes ?? 3}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </label>
  );
}

export function Carte(props: { titre?: string; sousTitre?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="carte">
      {(props.titre || props.actions) && (
        <header className="carte__entete">
          <div>
            {props.titre && <h2>{props.titre}</h2>}
            {props.sousTitre && <p className="discret">{props.sousTitre}</p>}
          </div>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}
