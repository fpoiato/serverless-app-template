import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// eslint-disable-next-line no-console -- falha no bootstrap: não há app para reportar
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
