import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { APP_CONFIG, loadRuntimeConfig } from './app/core/config/app-config';

// /config.json (gerado no deploy) define cor, versão e URLs antes de o app iniciar.
loadRuntimeConfig()
  .then((runtime) =>
    bootstrapApplication(App, {
      ...appConfig,
      providers: [...appConfig.providers, { provide: APP_CONFIG, useValue: runtime }],
    }),
  )
  // eslint-disable-next-line no-console -- falha no bootstrap: não há app para reportar
  .catch((err) => console.error(err));
