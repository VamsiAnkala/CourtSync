import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { hideBoot } from './core/boot';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  template: '<router-outlet />',
})
export class App {
  constructor() {
    // Safety net: pages hide the splash once loaded; never leave it up forever.
    setTimeout(hideBoot, 12000);
  }
}
