import { NgModule, LOCALE_ID } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HttpClientModule } from '@angular/common/http';
import { registerLocaleData } from '@angular/common';
import localeFr from '@angular/common/locales/fr';

import { AppComponent } from './app.component';
import { AppRoutingModule } from './app-routing.module';
import { NavDockComponent } from './components/nav-dock/nav-dock.component';
import { PlanetInfoPanelComponent } from './components/planet-info-panel/planet-info-panel.component';
import { SolarSystemComponent } from './components/solar-system/solar-system.component';
import { TimeScrubberComponent } from './components/time-scrubber/time-scrubber.component';
import { VoyagerMapComponent } from './components/voyager-map/voyager-map.component';
import { TranslatePipe } from './pipes/translate.pipe';

registerLocaleData(localeFr);

@NgModule({
  declarations: [
    AppComponent,
    SolarSystemComponent,
    PlanetInfoPanelComponent,
    VoyagerMapComponent,
    NavDockComponent,
    TimeScrubberComponent,
    TranslatePipe
  ],
  imports: [BrowserModule, BrowserAnimationsModule, HttpClientModule, AppRoutingModule],
  providers: [{ provide: LOCALE_ID, useValue: 'fr-FR' }],
  bootstrap: [AppComponent]
})
export class AppModule {}
