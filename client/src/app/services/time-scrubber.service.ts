import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class TimeScrubberService {
  // Range: last 365 days -> now
  private readonly offsetDaysSubject = new BehaviorSubject<number>(0);
  readonly offsetDays$ = this.offsetDaysSubject.asObservable();

  get offsetDays(): number {
    return this.offsetDaysSubject.value;
  }

  setOffsetDays(days: number): void {
    const clamped = Math.max(-365, Math.min(0, days));
    const snapped = Math.round(clamped); // 1 day steps
    this.offsetDaysSubject.next(snapped);
  }
}
