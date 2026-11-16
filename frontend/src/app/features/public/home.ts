import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { PROJECT } from '../../core/config/project';

@Component({
  selector: 'app-home',
  imports: [CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>{{ project.displayName }}</h1>
      <p>
        Projeto criado a partir do serverless-app-template. Comece pela primeira issue da Fase 1.
      </p>
      <p class="hint" data-testid="locale-sample">
        Formato de moeda: {{ 1234567 / 100 | currency }}
      </p>
    </section>
  `,
  styles: `
    .hero {
      padding: 2rem 0;
    }
    .hint {
      color: var(--app-muted);
    }
  `,
})
export class Home {
  protected readonly project = PROJECT;
}
