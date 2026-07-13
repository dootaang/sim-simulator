<script lang="ts">export type IconName='settings'|'plus'|'message'|'user'|'badge'|'list'|'pencil'|'copy'|'trash'|'ellipsis'|'undo'|'redo'|'refresh'|'left'|'right'|'send'|'stop'|'chevron'|'bot'|'star'|'alert'|'box'|'blocked'|'coin'|'heart'|'bed'|'moon'|'food'|'drink'|'close';let{name:rawName,size=18,label=''}:{name:IconName|string;size?:number;label?:string}=$props();const map:Record<string,IconName>={'⚙️':'settings','🤝':'user','👋':'user','⭐':'star','🚫':'blocked','🪵':'box','📦':'box','🪙':'coin','❤️':'heart','🛏️':'bed','🚪':'bed','🌙':'moon','🍚':'food','🍶':'drink'};let name=$derived(map[rawName]??rawName);</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden={label?'false':'true'} role={label?'img':undefined}>{#if label}<title>{label}</title>{/if}
{#if name==='settings'}<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>
{:else if name==='plus'}<path d="M12 5v14M5 12h14"/>
{:else if name==='message'}<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>
{:else if name==='user'}<circle cx="12" cy="8" r="4"/><path d="M4 22a8 8 0 0 1 16 0"/>
{:else if name==='badge'}<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>
{:else if name==='list'}<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
{:else if name==='pencil'}<path d="m4 20 4-1 11-11-3-3L5 16l-1 4ZM14 6l3 3"/>
{:else if name==='copy'}<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
{:else if name==='trash'}<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>
{:else if name==='ellipsis'}<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
{:else if name==='undo'||name==='redo'||name==='refresh'}<path d={name==='redo'?'M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7':name==='undo'?'M4 7v5h5M4 12a8 8 0 1 1 2.3 5.7':'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7'}/>
{:else if name==='left'}<path d="m15 18-6-6 6-6"/>
{:else if name==='right'}<path d="m9 18 6-6-6-6"/>
{:else if name==='send'}<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>
{:else if name==='stop'}<rect x="6" y="6" width="12" height="12" rx="1" fill="currentColor"/>
{:else if name==='chevron'}<path d="m6 9 6 6 6-6"/>
{:else if name==='bot'}<rect x="4" y="7" width="16" height="12" rx="3"/><path d="M12 3v4M8 12h.01M16 12h.01M8 16h8"/>
{:else if name==='star'}<path d="m12 2 3 6 7 .9-5 4.8 1.2 6.8L12 17l-6.2 3.5L7 13.7 2 9l7-.9Z" fill="currentColor"/>
{:else if name==='alert'}<path d="M10.3 3.7 2.4 18a2 2 0 0 0 1.8 3h15.6a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>
{:else if name==='blocked'}<circle cx="12" cy="12" r="9"/><path d="m6 6 12 12"/>
{:else if name==='box'}<path d="m4 7 8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7M12 11v10"/>
{:else if name==='coin'}<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>
{:else if name==='heart'}<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>
{:else if name==='bed'}<path d="M3 20v-8h18v8M3 16h18M7 12V8h5a4 4 0 0 1 4 4"/>
{:else if name==='moon'}<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>
{:else if name==='food'}<path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M16 3v18M16 3c4 2 4 8 0 10"/>
{:else if name==='drink'}<path d="M5 3h14l-2 8a5 5 0 0 1-10 0L5 3ZM12 16v5M8 21h8"/>
{:else if name==='close'}<path d="m6 6 12 12M18 6 6 18"/>
{:else}<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8.9c0 1.8-2.3 2-2.3 3.6M12 17h.01"/>{/if}</svg>
