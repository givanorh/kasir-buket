import type { Role } from './types';

/** Nama peran di antarmuka: peran "kasir" di data tampil sebagai Admin. */
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', kasir: 'Admin', perangkai: 'Perangkai' };

/** "Admin + Perangkai" untuk akun berperan ganda. */
export const rolesLabel = (u?: { role?: Role; roles?: Role[] } | null) =>
  (u?.roles?.length ? u.roles : u?.role ? [u.role] : []).map((r) => ROLE_LABEL[r]).join(' + ');
