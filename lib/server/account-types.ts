import type { Role } from "@/lib/model";

export interface UserListFilters {
  search?: string;
  role?: Role;
  status?: "active" | "deactivated";
  page: number;
  pageSize: number;
}

export interface AccountUserDto {
  id: string;
  name: string;
  email: string;
  department: string;
  active: boolean;
  roles: Role[];
  requesterRole: "student" | "faculty" | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  deactivationReason: string | null;
  deactivatedBy: { id: string; name: string } | null;
}

export interface UserListDto {
  items: AccountUserDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
  };
}

export interface AccountUserRow {
  id: string;
  name: string;
  email: string;
  department: string;
  active: boolean;
  roles: Role[];
  requester_role: "student" | "faculty" | null;
  created_at: Date | string;
  updated_at: Date | string;
  deactivated_at: Date | string | null;
  deactivation_reason: string | null;
  deactivated_by_user_id: string | null;
  deactivated_by_name: string | null;
}