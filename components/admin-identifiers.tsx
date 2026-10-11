"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { AccountUserDto } from "@/lib/server/account-types";
import type { InstitutionalIdentifierDto } from "@/lib/server/admin-governance-types";
import {
  findIdentifierOverwrite,
  identifierMutationMessage,
  identifierTypeLabel,
  identifierTypeOptions,
  normalizeIdentifierValue,
  validateIdentifierDraft,
} from "@/lib/identifier-admin-ui";
import { useToast } from "./toast";
import { Alert, Card, Confirm, Empty, Field, PageHeading } from "./ui";

async function errorCode(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown } };
    return typeof body.error?.code === "string" ? body.error.code : undefined;
  } catch {
    return undefined;
  }
}

function roleSummary(account: AccountUserDto) {
  if (account.roles.includes("admin")) return "Administrator";
  if (account.roles.includes("approver")) return "Approver";
  if (account.requesterRole === "faculty") return "Faculty";
  if (account.requesterRole === "student") return "Student";
  return account.roles[0] ?? "Account";
}

export function AdminIdentifiers({
  accounts,
  accountTotal,
  search,
  selectedAccount,
  identifiers,
}: {
  accounts: AccountUserDto[];
  accountTotal: number;
  search: string;
  selectedAccount: AccountUserDto | null;
  identifiers: InstitutionalIdentifierDto[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [query, setQuery] = useState(search);
  const [identifierType, setIdentifierType] = useState("");
  const [issuer, setIssuer] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [success, setSuccess] = useState("");
  const [overwrite, setOverwrite] = useState<{ previous: string } | null>(null);

  function navigate(params: Record<string, string | undefined>) {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) next.set(key, value);
    }
    const queryString = next.toString();
    router.push(`/admin/identifiers${queryString ? `?${queryString}` : ""}`);
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate({ q: query.trim() || undefined });
  }

  function selectAccount(id: string) {
    setFailure("");
    setSuccess("");
    navigate({ q: search || undefined, account: id });
  }

  async function save() {
    if (!selectedAccount || busy) return;
    setBusy(true);
    setFailure("");
    setSuccess("");
    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(selectedAccount.id)}/identifiers`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ identifierType, issuer: issuer.trim(), identifier: identifier.trim() }),
        },
      );
      if (!response.ok) {
        const message = identifierMutationMessage(response.status, await errorCode(response));
        setFailure(message);
        toast.error({ title: "Identifier not saved", description: message });
        return;
      }
      const savedMessage = `${identifierTypeLabel(identifierType)} saved for ${selectedAccount.name}.`;
      setSuccess(savedMessage);
      toast.success({ title: "Identifier saved", description: savedMessage });
      setIdentifierType("");
      setIssuer("");
      setIdentifier("");
      setOverwrite(null);
      router.refresh();
    } catch {
      const message = "The identifier could not be saved. Check your connection and try again.";
      setFailure(message);
      toast.error({ title: "Identifier not saved", description: message });
    } finally {
      setBusy(false);
    }
  }

  function submitIdentifier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure("");
    setSuccess("");
    const draft = { identifierType, issuer, identifier };
    const validation = validateIdentifierDraft(draft);
    if (validation) {
      setFailure(validation);
      return;
    }
    const existingOverwrite = findIdentifierOverwrite(draft, identifiers);
    if (existingOverwrite) {
      setOverwrite(existingOverwrite);
      return;
    }
    void save();
  }

  return (
    <>
      <PageHeading
        eyebrow="ADMIN › GOVERNANCE"
        title="Institutional identifier maintenance"
        description="Maintain the institutional student and staff numbers associated with an account. Identifiers remain separate from internal account UUIDs."
      />
      <Alert title="Server-enforced maintenance" tone="info">
        Identifier changes are validated and audited on the server and require
        an active administrator. Each institutional number is unique within its
        issuer, and each account holds one value per identifier type and issuer;
        saving an existing type and issuer replaces its stored value.
      </Alert>
      {failure && !overwrite && (
        <Alert title="Action not completed" tone="danger">{failure}</Alert>
      )}
      {success && (
        <div role="status">
          <Alert title="Update complete" tone="success">{success}</Alert>
        </div>
      )}
      <Card title="Find an account">
        <form className="identifier-search" onSubmit={submitSearch} role="search">
          <Field id="identifier-account-search" label="Search by name or email">
            <input
              id="identifier-account-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="e.g. Sam Requester or sam@example.edu"
            />
          </Field>
          <div className="responsibility-actions">
            <button className="button button-outline" type="submit">Search accounts</button>
          </div>
        </form>
        {!accounts.length ? (
          <Empty
            title="No accounts found"
            description={search ? "Try a different name or email." : "Search for an account to maintain its identifiers."}
          />
        ) : (
          <div className="table-scroll" role="region" aria-label="Account results" tabIndex={0}>
            <table className="responsibility-table">
              <caption className="sr-only">Accounts matching the search</caption>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col">Role</th>
                  <th scope="col">Department</th>
                  <th scope="col">Status</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const isSelected = selectedAccount?.id === account.id;
                  return (
                    <tr key={account.id} data-account-id={account.id} aria-selected={isSelected}>
                      <td>
                        <strong>{account.name}</strong>
                        <small className="table-secondary">{account.email}</small>
                      </td>
                      <td><span className="access-level">{roleSummary(account)}</span></td>
                      <td>{account.department}</td>
                      <td>
                        <span className={`badge ${account.active ? "tone-success" : "tone-neutral"}`}>
                          {account.active ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`button ${isSelected ? "button-primary" : "button-outline"}`}
                          type="button"
                          aria-label={`Manage identifiers for ${account.name}`}
                          onClick={() => selectAccount(account.id)}
                        >
                          {isSelected ? "Selected" : "Manage identifiers"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {accountTotal > accounts.length && (
          <p className="small muted">
            Showing {accounts.length} of {accountTotal} matching accounts. Refine the search to narrow results.
          </p>
        )}
      </Card>
      {selectedAccount && (
        <>
          <Card
            title={`Identifiers for ${selectedAccount.name}`}
            className="responsibility-list-card"
          >
            {!identifiers.length ? (
              <Empty
                title="No identifiers recorded"
                description="Add a student or staff number below to associate it with this account."
              />
            ) : (
              <div className="table-scroll" role="region" aria-label="Account identifiers" tabIndex={0}>
                <table className="responsibility-table">
                  <caption className="sr-only">Identifiers for {selectedAccount.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Type</th>
                      <th scope="col">Issuer</th>
                      <th scope="col">Identifier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {identifiers.map((item) => (
                      <tr key={item.id} data-identifier-id={item.id}>
                        <td>{identifierTypeLabel(item.identifierType)}</td>
                        <td>{item.issuer}</td>
                        <td><code>{item.identifier}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          <Card title="Add or update an identifier" className="responsibility-form-card">
            <form className="responsibility-form" onSubmit={submitIdentifier}>
              <div className="responsibility-form-grid">
                <Field id="identifier-type" label="Identifier type" required>
                  <select
                    id="identifier-type"
                    value={identifierType}
                    onChange={(event) => setIdentifierType(event.target.value)}
                    required
                  >
                    <option value="">Choose a type</option>
                    {identifierTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </Field>
                <Field id="identifier-issuer" label="Issuer" required hint="The institutional namespace that issued the number.">
                  <input
                    id="identifier-issuer"
                    type="text"
                    value={issuer}
                    onChange={(event) => setIssuer(event.target.value)}
                    maxLength={120}
                    required
                  />
                </Field>
                <Field id="identifier-value" label="Identifier" required hint="Stored upper-cased and unique per issuer.">
                  <input
                    id="identifier-value"
                    type="text"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    onBlur={() => setIdentifier((current) => normalizeIdentifierValue(current))}
                    maxLength={80}
                    required
                  />
                </Field>
              </div>
              <div className="responsibility-actions">
                <button className="button button-primary" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save identifier"}
                </button>
              </div>
            </form>
          </Card>
        </>
      )}
      {overwrite && selectedAccount && (
        <Confirm
          title="Replace existing identifier?"
          label={busy ? "Saving…" : "Replace identifier"}
          busy={busy}
          onClose={() => setOverwrite(null)}
          onConfirm={() => void save()}
        >
          <p>
            {selectedAccount.name} already has a {identifierTypeLabel(identifierType).toLowerCase()} for
            this issuer (<code>{overwrite.previous}</code>). Saving replaces it with{" "}
            <code>{normalizeIdentifierValue(identifier)}</code>.
          </p>
          <p className="small muted">The change is recorded in the audit log.</p>
          {failure && <p className="field-error" role="alert">{failure}</p>}
        </Confirm>
      )}
    </>
  );
}
