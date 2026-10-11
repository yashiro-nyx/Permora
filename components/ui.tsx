"use client";

import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Status, Tone, statusLabels } from "@/lib/model";

export const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = 10;

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
  variant?:
    | "primary"
    | "secondary"
    | "outline"
    | "ghost"
    | "approve"
    | "danger";
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
  padded = false,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Adds consistent internal body padding (opt-in to avoid changing existing layouts). */
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? "card-padded" : ""} ${className}`}>
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

/**
 * Shared scroll + accessibility wrapper for data tables. Keeps the
 * `.table-scroll` focusable region, caption, and responsive overflow behavior
 * consistent instead of repeating the markup on every page.
 */
export function DataTable({
  label,
  caption,
  children,
  className = "",
}: {
  label: string;
  caption?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={label}>
      <table className={`data-table ${className}`}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
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
  // Auto-wire accessibility attributes onto the single control passed as a
  // child so every Field consumer gets aria-describedby (hint + error) and
  // aria-invalid without having to repeat them at each call site.
  const describedBy =
    [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;
  let control = children;
  if (isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>;
    const existing =
      typeof child.props["aria-describedby"] === "string"
        ? (child.props["aria-describedby"] as string)
        : undefined;
    const merged =
      [existing, describedBy].filter(Boolean).join(" ") || undefined;
    control = cloneElement(child, {
      "aria-describedby": merged,
      "aria-invalid": error ? true : child.props["aria-invalid"],
    });
  }
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
      {control}
      {hint && (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="field-error" role="alert">
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
export function Spinner({
  label = "Loading…",
  size = 20,
}: {
  label?: string;
  size?: number;
}) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span
        className="spinner-mark"
        aria-hidden="true"
        style={{ width: size, height: size }}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** A single shimmering placeholder bar. Width/height are configurable. */
export function Skeleton({
  width,
  height = 14,
  radius = 6,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <span
      className={`skeleton ${className}`}
      aria-hidden="true"
      style={{ width: width ?? "100%", height, borderRadius: radius }}
    />
  );
}

/** Several stacked text lines; the last line is shortened for realism. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <span className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          key={index}
          height={12}
          width={index === lines - 1 ? "60%" : "100%"}
        />
      ))}
    </span>
  );
}

/** A card-shaped placeholder resembling the Card primitive. */
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <section className="card skeleton-card" aria-hidden="true">
      <Skeleton width="40%" height={16} />
      <SkeletonText lines={lines} />
    </section>
  );
}

/** A table-shaped placeholder matching the .table-scroll table layout. */
export function SkeletonTable({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="skeleton-table" aria-hidden="true">
      <div className="skeleton-table-row skeleton-table-head">
        {Array.from({ length: columns }, (_, index) => (
          <Skeleton key={index} height={12} width="70%" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div className="skeleton-table-row" key={rowIndex}>
          {Array.from({ length: columns }, (_, colIndex) => (
            <Skeleton key={colIndex} height={12} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A form-shaped placeholder matching the .form-grid / .field layout. */
export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="skeleton-form" aria-hidden="true">
      {Array.from({ length: fields }, (_, index) => (
        <div className="skeleton-field" key={index}>
          <Skeleton width="30%" height={11} />
          <Skeleton height={42} radius={8} />
        </div>
      ))}
    </div>
  );
}

/**
 * A full page-loading placeholder for route-level loading.tsx boundaries. It
 * renders a heading skeleton plus a chosen content shape, wrapped in a polite
 * status region so assistive technology announces the loading state once.
 */
export function PageSkeleton({
  shape = "table",
  label = "Loading…",
}: {
  shape?: "table" | "form" | "cards" | "detail";
  label?: string;
}) {
  return (
    <div className="page-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton-heading" aria-hidden="true">
        <Skeleton width={220} height={26} />
        <Skeleton width={320} height={12} />
      </div>
      {shape === "table" && (
        <section className="card skeleton-card">
          <SkeletonTable rows={6} columns={4} />
        </section>
      )}
      {shape === "form" && (
        <section className="card skeleton-card">
          <SkeletonForm fields={5} />
        </section>
      )}
      {shape === "cards" && (
        <div className="skeleton-card-grid">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}
      {shape === "detail" && (
        <div className="skeleton-card-grid skeleton-detail">
          <SkeletonCard lines={6} />
          <SkeletonCard lines={4} />
        </div>
      )}
    </div>
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
/**
 * URL-driven pagination for server-paginated tables. Reads/writes `page` and
 * `pageSize` on the current route's query string so pagination state survives
 * navigation and preserves existing search/filter/sort params. Includes a
 * page-size selector (10/25/50), First/Prev/Next/Last controls, and a
 * "Showing X–Y of N" summary. On mobile it collapses to Prev / page / Next.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  pageCount,
  itemCount,
  label = "Pagination",
}: {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  /** Number of rows actually rendered on this page (for the range summary). */
  itemCount: number;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pages = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), pages);

  const navigate = (nextPage: number, nextPageSize = pageSize) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(nextPage));
    params.set("pageSize", String(nextPageSize));
    router.push(`${pathname}?${params.toString()}`);
  };

  const start = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const end = total === 0 ? 0 : start + itemCount - 1;

  return (
    <div className="pagination table-pagination">
      <div className="pagination-summary">
        <span>
          Showing <strong>{start}</strong>–<strong>{end}</strong> of{" "}
          <strong>{total}</strong>
        </span>
        <label className="pagination-size">
          <span className="sr-only">Rows per page</span>
          <select
            value={pageSize}
            onChange={(event) => navigate(1, Number(event.target.value))}
            aria-label="Rows per page"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav aria-label={label} className="pagination-controls">
        <Button
          variant="outline"
          disabled={current <= 1}
          onClick={() => navigate(1)}
          aria-label="First page"
          className="pagination-edge"
        >
          «
        </Button>
        <Button
          variant="outline"
          disabled={current <= 1}
          onClick={() => navigate(current - 1)}
          aria-label="Previous page"
        >
          ‹<span className="pagination-word"> Prev</span>
        </Button>
        <span className="pagination-status" aria-current="page">
          Page {current} of {pages}
        </span>
        <Button
          variant="outline"
          disabled={current >= pages}
          onClick={() => navigate(current + 1)}
          aria-label="Next page"
        >
          <span className="pagination-word">Next </span>›
        </Button>
        <Button
          variant="outline"
          disabled={current >= pages}
          onClick={() => navigate(pages)}
          aria-label="Last page"
          className="pagination-edge"
        >
          »
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
