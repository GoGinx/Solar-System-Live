import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';

import { SolarSystemComponent } from './components/solar-system/solar-system.component';
import { VoyagerMapComponent } from './components/voyager-map/voyager-map.component';

const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'solar' },
  { path: 'solar', component: SolarSystemComponent, data: { anim: 'solar' } },
  { path: 'voyager/:id', component: VoyagerMapComponent, data: { anim: 'voyager' } },
  { path: '**', redirectTo: 'solar' }
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {
      bindToComponentInputs: true,
      scrollPositionRestoration: 'disabled'
    })
  ],
  exports: [RouterModule]
})
export class AppRoutingModule {}

