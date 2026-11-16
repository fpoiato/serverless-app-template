import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-account-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Minha conta</h1>
    <p>Em breve: login, visitas, reservas e conversas.</p>`,
})
export class AccountHome {}
