import { Component, ChangeDetectionStrategy } from '@angular/core';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'app-nav-dock',
  templateUrl: './nav-dock.component.html',
  styleUrls: ['./nav-dock.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NavDockComponent {
  constructor(public i18n: I18nService) {}

  toggleLanguage(): void {
    this.i18n.toggleLanguage();
  }

  get languageLabel(): string {
    return this.i18n.language.toUpperCase();
  }
}
