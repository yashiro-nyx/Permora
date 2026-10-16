import { AccountDirectory } from "@/components/account-management";
import {
  AccountServiceError,
  parseUserListFilters,
} from "@/lib/account-management";
import { listUsers } from "@/lib/server/account-service";
import type { UserListFilters } from "@/lib/server/account-types";
import { requireAdmin } from "@/lib/server/identity";

export const metadata = { title: "User management" };
export const dynamic = "force-dynamic";

function paramsOf(values: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) params.set(key, first);
  }
  return params;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const params = paramsOf(await searchParams);
  let filters: UserListFilters;
  let invalidMessage: string | undefined;
  try {
    filters = parseUserListFilters(params);
  } catch (error) {
    if (!(error instanceof AccountServiceError)) throw error;
    filters = parseUserListFilters(new URLSearchParams());
    invalidMessage = "The search or filter values were invalid.";
  }
  let data = await listUsers(paramsOf({
    search: filters.search,
    role: filters.role,
    status: filters.status,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
  }));
  const lastPage = Math.max(1, data.pagination.pageCount);
  if (filters.page > lastPage) {
    filters = { ...filters, page: lastPage };
    data = await listUsers(paramsOf({
      search: filters.search,
      role: filters.role,
      status: filters.status,
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    }));
  }
  return (
    <AccountDirectory
      data={data}
      filters={filters}
      invalidMessage={invalidMessage}
    />
  );
}
