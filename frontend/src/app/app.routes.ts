import type { Routes } from '@angular/router';
import { PROJECT } from './core/config/project';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./features/public/home').then((m) => m.Home),
    title: PROJECT.displayName,
  },
  {
    path: 'conta',
    loadComponent: () => import('./features/account/account-home').then((m) => m.AccountHome),
    title: `${PROJECT.displayName} — Minha conta`,
  },
  {
    path: 'admin',
    loadComponent: () => import('./features/admin/admin-home').then((m) => m.AdminHome),
    title: `${PROJECT.displayName} — Admin`,
  },
  {
    path: '**',
    loadComponent: () => import('./shared/not-found').then((m) => m.NotFound),
    title: `${PROJECT.displayName} — Página não encontrada`,
  },
];
