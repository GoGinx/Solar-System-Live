import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { animate, query, style, transition, trigger } from '@angular/animations';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [
    trigger('routeAnimations', [
      transition('* <=> *', [
        query(
          ':enter, :leave',
          [
            style({
              position: 'absolute',
              inset: 0
            })
          ],
          { optional: true }
        ),
        query(':leave', [animate('220ms ease', style({ opacity: 0, transform: 'translateX(-10px)' }))], {
          optional: true
        }),
        query(':enter', [style({ opacity: 0, transform: 'translateX(10px)' }), animate('260ms ease', style({ opacity: 1, transform: 'translateX(0)' }))], {
          optional: true
        })
      ])
    ])
  ]
})
export class AppComponent {
  prepareRoute(outlet: RouterOutlet) {
    return outlet?.activatedRouteData?.['anim'] ?? 'route';
  }
}
