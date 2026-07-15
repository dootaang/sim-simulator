export * from './support.ts';
export * from './common.ts';
export * from './advanced.ts';
export * from './hunter.ts';
export * from './combat.ts';
export * from './inn.ts';
export * from './inn-traffic.ts';
export * from './stats.ts';
export * from './catalog.ts';
export * from './genre-templates.ts';
import { ModuleRegistry } from '@simbot/kernel'; import { commonModules } from './common.ts'; import { craftingModule,equipmentModule,questsModule,shopModule } from './advanced.ts'; import { hunterModule } from './hunter.ts'; import { combatModule } from './combat.ts'; import { statsModule } from './stats.ts'; import { innModule } from './inn.ts'; import { innTrafficModule } from './inn-traffic.ts';
export function createCoreRegistry(){const registry=new ModuleRegistry();registry.register(statsModule());for(const module of commonModules())registry.register(module);for(const module of [equipmentModule(),questsModule(),shopModule(),craftingModule(),combatModule()])registry.register(module);return registry;}
export function createStandardRegistry(){return createCoreRegistry();}
export function createHunterRegistry(){return createCoreRegistry().register(hunterModule());}
export function createInnRegistry(){return createCoreRegistry().register(innModule()).register(innTrafficModule());}
