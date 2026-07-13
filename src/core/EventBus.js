import Phaser from 'phaser'

// 全局事件总线:模块间只通过事件通信,禁止互相持有引用。
// 事件命名约定 domain:action,如 'enemy:died' 'player:hurt' 'gib:dismembered'
export const EventBus = new Phaser.Events.EventEmitter()
