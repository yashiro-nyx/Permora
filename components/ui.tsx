"use client";

import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Status, Tone, statusLabels } from "@/lib/model";

const iconAliases: Record<string, string> = {
  lab: "building",
  search: "help",
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="icon"
      style={
        {
          width: size,
          height: size,
          maskImage: `url('/assets/${iconAliases[name] ?? name}.svg')`,
        } as CSSProperties
      }
    />
  );
}
export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?:
    "primary" | "secondary" | "outline" | "ghost" | "approve" | "danger";
}) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function LinkButton({
  href,
  children,
  variant = "primary",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "outline" | "ghost";
  className?: string;
}) {
  return (
    <Link href={href} className={`button button-${variant} ${className}`}>
      {children}
    </Link>
  );
}
export function Badge({
  status,
  label,
  tone,
}: {
  status?: Status;
  label?: string;
  tone?: Tone;
}) {
  const color =
    tone ??
    (status === "pending" ||
    status === "pending_routing" ||
    status === "pending_review"
      ? "warning"
      : status === "active" ||
          status === "approved" ||
          status === "approved_pending_activation"
        ? "success"
        : status === "denied" ||
            status === "returned_for_revision" ||
            status === "revoked"
          ? "danger"
          : "neutral");
  return (
    <span className={`badge tone-${color}`}>
      <span aria-hidden="true" className="status-dot" />
      {label ?? (status ? statusLabels[status] : "")}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow breadcrumb">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-action">{action}</div>}
    </div>
  );
}
export function Card({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({
  title = "No results found",
  description = "Try changing your search or filters.",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="icon-tile tone-neutral">
        <Icon name="requests" size={24} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Alert({
  title,
  children,
  tone = "info",
}: {
  title: string;
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <div className={`alert tone-${tone}`}>
      <Icon name={tone === "success" ? "check" : "help"} />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="required">
            {" "}
            *<span className="sr-only"> required</span>
          </span>
        )}
      </label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function ErrorSummary({ errors }: { errors: Record<string, string> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (Object.keys(errors).length) ref.current?.focus();
  }, [errors]);
  return Object.keys(errors).length ? (
    <div ref={ref} tabIndex={-1} className="error-summary" role="alert">
      <strong>Please check the following</strong>
      <ul>
        {Object.entries(errors).map(([id, error]) => (
          <li key={id}>
            <a href={`#${id}`}>{error}</a>
          </li>
        ))}
      </ul>
    </div>
  ) : null;
}
export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      node?.close();
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <Button variant="ghost" onClick={onClose} aria-label="Close dialog">
          ×
        </Button>
      </div>
      {children}
    </dialog>
  );
}
export function Confirm({
  title,
  children,
  onClose,
  onConfirm,
  label = "Confirm",
  danger = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onConfirm: () => void;
  label?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body">{children}</div>
      <div className="modal-actions">
        <Button variant="outline" onClick={onClose} disabled={busy} autoFocus>
          Cancel
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          onClick={onConfirm}
          disabled={busy}
        >
          {label}
        </Button>
      </div>
    </Modal>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 5,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="pagination">
      <span>
        Showing{" "}
        <strong>
          {total ? (page - 1) * pageSize + 1 : 0}–
          {Math.min(page * pageSize, total)}
        </strong>{" "}
        of <strong>{total}</strong> results
      </span>
      <nav aria-label="Pagination">
        <Button
          variant="outline"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          ‹
        </Button>
        {Array.from({ length: pages }, (_, i) => i + 1)
          .filter((p) => p === 1 || p === pages || Math.abs(p - page) <= 1)
          .map((p, i, a) => (
            <span key={p}>
              {i > 0 && p - a[i - 1] > 1 && <span className="ellipsis">…</span>}
              <Button
                variant={p === page ? "primary" : "outline"}
                aria-current={p === page ? "page" : undefined}
                onClick={() => onChange(p)}
              >
                {p}
              </Button>
            </span>
          ))}
        <Button
          variant="outline"
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          ›
        </Button>
      </nav>
    </div>
  );
}
export function exportCsv(name: string, rows: (string | number)[][]) {
  const text = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);
          return `"${(/^[=+@\-\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
