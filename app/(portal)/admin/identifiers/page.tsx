import { AdminIdentifiers } from "@/components/admin-identifiers";
import { getUser, listUsers } from "@/lib/server/account-service";
import { listUserIdentifiers } from "@/lib/server/admin-governance-service";
import type { AccountUserDto } from "@/lib/server/account-types";
import type { InstitutionalIdentifierDto } from "@/lib/server/admin-governance-types";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "Institutional identifier maintenance" };
export const dynamic = "force-dynamic";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACCOUNT_PAGE_SIZE = 10;

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const values = await searchParams;
  const rawSearch = Array.isArray(values.q) ? values.q[0] : values.q;
  const rawAccount = Array.isArray(values.account) ? values.account[0] : values.account;
  const search = (rawSearch ?? "").trim().slice(0, 100);

  let accounts: AccountUserDto[] = [];
  let accountTotal = 0;
  // Only query the directory once a search term is present, to avoid listing
  // every account by default.
  if (search) {
    const params = new URLSearchParams();
    params.set("search", search);
    params.set("page", "1");
    params.set("pageSize", String(ACCOUNT_PAGE_SIZE));
    const data = await listUsers(params);
    accounts = data.items;
    accountTotal = data.pagination.total;
  }

  let selectedAccount: AccountUserDto | null = null;
  let identifiers: InstitutionalIdentifierDto[] = [];
  if (rawAccount && UUID.test(rawAccount)) {
    selectedAccount = await getUser(rawAccount);
    if (selectedAccount) identifiers = await listUserIdentifiers(selectedAccount.id);
  }

  return (
    <AdminIdentifiers
      accounts={accounts}
      accountTotal={accountTotal}
      search={search}
      selectedAccount={selectedAccount}
      identifiers={identifiers}
    />
  );
}
