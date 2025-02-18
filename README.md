# cocos creator 中使用 mobx 的一个工具
yarn install mobx-cocos
## 使用说明
```ts
// cfg.ts
// mobx 相关配置
import { configure } from "mobx";
configure({ enforceActions: "observed" });
```
```ts
// componentStore.ts
// 数据源

import { observable } from "mobx";
class ComponentStore {
  @observable public array: number[] = [0, 1, 2];
  @observable public counter = 0;
  @observable public shadowCounter = this.counter;
}
export const componentStore = new ComponentStore();
```
```ts
// Component.ts
import { observer, render, reactor, react } from "mobx-cocos";
import { componentStore as store } from "./componentStore";
import { action, observable } from "mobx";
const { ccclass } = cc._decorator;
/**
 * 由 @observer 注解的类, 会将 @render 和 @reactor 所注解的方法 纳入生命周期来管理
 */
@ccclass
@observer
export class Component extends cc.Component {
  @observable private index = 0;
  protected onLoad(){
    // 没间隔1秒钟增加this.index
    this.schedule(this.addIndex, 1);
  }
  // @render 注解的方法会在 onLoad执行之后自动调用一次, 并在 counter每次发生变化的时候执行
  @render protected renderCounter(){
    console.log("store.counter = " + store.counter);
  }

  // 监听 store.shadowCounter
  @render protected renderShadowCounter(){
    console.log("store.shadowCounter = " + store.shadowCounter0);
  }

  // 监听 store.array[this.index % store.array.length] 的数值, 来修改 store.counter的数值
  @reactor
  protected componentCounterReactor(){
    return react(()=> store.array[this.index % store.array.length], (value)=> store.counter = value);
  }

  @action private addIndex(){
    store.index++;
  }
}
```
