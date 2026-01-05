import { Component, ChangeDetectionStrategy, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { TimeScrubberService } from '../../services/time-scrubber.service';
import { I18nService } from '../../services/i18n.service';

@Component({
  selector: 'app-time-scrubber',
  templateUrl: './time-scrubber.component.html',
  styleUrls: ['./time-scrubber.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TimeScrubberComponent implements OnInit, OnDestroy {
  private langSub?: Subscription;

  constructor(
    public time: TimeScrubberService,
    public i18n: I18nService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.langSub = this.i18n.lang$.subscribe(() => {
      this.cdr.markForCheck();
    });
  }

  ngOnDestroy(): void {
    this.langSub?.unsubscribe();
    this.langSub = undefined;
  }

  onInput(raw: string): void {
    const v = Number.parseFloat(raw);
    if (!Number.isFinite(v)) return;
    this.time.setOffsetDays(v);
  }

  get monthLabels(): string[] {
    const months = this.getMonthShortLabels();
    const current = new Date().getMonth();
    const ordered: string[] = [];
    for (let offset = 11; offset >= 0; offset -= 1) {
      const idx = (current - offset + 1200) % 12;
      ordered.push(months[idx]);
    }
    return ordered;
  }

  private getMonthShortLabels(): string[] {
    const raw = this.i18n.t('months.short');
    const parsed = raw
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (parsed.length === 12) return parsed;
    return ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  }

  private formatYears(value: number): string {
    const fixed = value.toFixed(2);
    return fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  }

  get label(): string {
    const days = this.time.offsetDays;
    if (days === 0) return this.i18n.t('label.now');
    const years = Math.abs(days) / 365.25;
    const sign = days < 0 ? '-' : '+';
    const unit = this.i18n.t('unit.yearShort');
    return `T${sign}${this.formatYears(years)}${unit}`;
  }

  get selectedDateLabel(): string {
    const days = this.time.offsetDays;
    const base = new Date();
    const target = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    target.setDate(target.getDate() + Math.round(days));
    const lang = this.i18n.language === 'fr' ? 'fr-FR' : 'en-US';
    return new Intl.DateTimeFormat(lang, {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).format(target);
  }
}
