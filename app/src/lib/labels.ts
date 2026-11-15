import type { Role } from './types';

/** Nama peran di antarmuka: peran "kasir" di data tampil sebagai Admin. */
export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', kasir: 'Admin', perangkai: 'Perangkai' };
