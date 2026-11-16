import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-admin-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<h1>Admin</h1>
    <p>Área administrativa.</p>`,
})
export class AdminHome {}
