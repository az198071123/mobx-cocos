import * as mobx from "mobx";
import {
  autorun,
  configure,
  IAutorunOptions,
  IReactionDisposer,
  IReactionOptions,
  IReactionPublic,
  reaction,
  runInAction,
} from "mobx";

configure({
  enforceActions: "observed",
  computedRequiresReaction: false,
  disableErrorBoundaries: true,
});

if (cc.sys.isBrowser) {
  (globalThis as any).mobx = mobx;
}

const observerProtoMapForAutoRun = new WeakMap<cc.Component, AutoRunConfig[]>();
const observerProtoMapForReaction = new WeakMap<
  cc.Component,
  ReactionConfig[]
>();

export const observer = <T extends { new (...args: any[]): cc.Component }>(
  constructor: T
) => {
  const cls = class extends constructor {
    private _disposerAtDisable: Map<string | symbol, IReactionDisposer>;
    private _disposerAtDestroy: Map<string | symbol, IReactionDisposer>;
    private _keepAutorunList: Map<string | symbol, AutoRunConfig>;
    private _autorunList: Map<string | symbol, AutoRunConfig>;
    private _keepReactionList: Map<string | symbol, ReactionConfig>;
    private _reactionList: Map<string | symbol, ReactionConfig>;
    private _caller: () => void;

    /**
     * @override
     */
    constructor(...args: any[]) {
      super(...args);

      // get all reaction by prototype chain
      let p = Object.getPrototypeOf(this);
      do {
        const renderFunctionList = observerProtoMapForAutoRun.get(p);
        if (renderFunctionList?.length) {
          this._keepAutorunList = this._keepAutorunList || new Map();
          this._autorunList = this._autorunList || new Map();
          renderFunctionList.forEach((r) => {
            if (r.options?.keep) {
              this._keepAutorunList.set(r.functionName, r);
            } else {
              this._autorunList.set(r.functionName, r);
            }
          });
        }

        const reactionFunctionList = observerProtoMapForReaction.get(p);
        if (reactionFunctionList?.length) {
          this._keepReactionList = this._keepReactionList || new Map();
          this._reactionList = this._reactionList || new Map();
          reactionFunctionList.forEach((r) => {
            if (r.options?.keep) {
              this._keepReactionList.set(r.functionName, r);
            } else {
              this._reactionList.set(r.functionName, r);
            }
          });
        }
      } while ((p = Object.getPrototypeOf(p)));
    }

    override onEnable() {
      super.onEnable?.();
      this.bindRender();
    }

    override onDisable() {
      this._disposeAtDisable();
      super.onDisable?.();
    }

    override onDestroy() {
      this._disposeAll();
      super.onDestroy?.();
    }

    override _destruct() {
      // fix that when node.onLoad has not been called but bindRender has been called, onDestroy will not be called
      // so we must call the dispose again.
      this._disposeAll();

      // cocos will set all property to null, so we must call destruction on action.
      runInAction(() => {
        super._destruct?.();
      });
    }

    /**
     * 手動綁定 render。用於 start 沒辦法觸發的情境 (ex. node.active = false) 時可以呼叫手動綁定
     */
    bindRender(caller = this.onEnable) {
      // secondary bind
      if (this._caller) {
        this._bindAutorun(this._autorunList);
        this._bindReaction(this._reactionList);
      } else {
        // first bind
        if (caller !== this.onEnable) {
          this._autorunList?.forEach((value, key) => {
            value.options = value.options || {};
            value.options.keep = true;
            this._keepAutorunList.set(key, value);
          });
          this._autorunList?.clear();

          this._reactionList?.forEach((value, key) => {
            value.options = value.options || {};
            value.options.keep = true;
            this._keepReactionList.set(key, value);
          });
          this._reactionList?.clear();
        }

        this._bindAutorun(this._autorunList);
        this._bindAutorun(this._keepAutorunList);
        this._bindReaction(this._reactionList);
        this._bindReaction(this._keepReactionList);
        this._caller = caller;
      }
    }

    private _bindReaction(reactionList: Map<string | symbol, ReactionConfig>) {
      if (reactionList?.size) {
        reactionList.forEach((config) => {
          const disposerMap = this._getDisposerMap(config);
          if (!disposerMap.has(config.functionName)) {
            const { expression, effect, options }: ReactReturn<any> = (
              this as any
            )[config.functionName]();
            disposerMap.set(
              config.functionName,
              reaction(expression, effect, {
                fireImmediately: true,
                name: `${constructor.name}.${config.functionName.toString()}`,
                ...config.options,
                ...options,
              })
            );
          }
        });
      }
    }

    private _bindAutorun(autorunList: Map<string | symbol, AutoRunConfig>) {
      if (autorunList?.size) {
        autorunList.forEach((config) => {
          const disposerMap = this._getDisposerMap(config);
          if (!disposerMap.has(config.functionName)) {
            disposerMap.set(
              config.functionName,
              autorun((this as any)[config.functionName].bind(this), {
                name: `${constructor.name}.${config.functionName.toString()}`,
                ...config.options,
              })
            );
          }
        });
      }
    }

    private _disposeAtDisable() {
      if (this._disposerAtDisable) {
        this._disposerAtDisable.forEach((x) => x());
        this._disposerAtDisable.clear();
      }
    }

    private _disposeAll() {
      this._disposeAtDisable();
      if (this._disposerAtDestroy) {
        this._disposerAtDestroy.forEach((x) => x());
        this._disposerAtDestroy.clear();
      }
      this._caller = null;
    }

    private _getDisposerMap(config: { options: { keep?: boolean } }) {
      if (config.options?.keep) {
        this._disposerAtDestroy = this._disposerAtDestroy || new Map();
        return this._disposerAtDestroy;
      } else {
        this._disposerAtDisable = this._disposerAtDisable || new Map();
        return this._disposerAtDisable;
      }
    }
  };

  // override the class name
  Object.defineProperty(cls, "name", {
    get: () => `${constructor.name}.Observer`,
  });
  return cls;
};

///
/// Decorator
///
interface DecoratorFunc {
  (
    target: cc.Component,
    key: string | symbol,
    baseDescriptor: PropertyDescriptor
  ): void;
}

interface OptionalDecoratorFunc<T> {
  (opts?: T): DecoratorFunc;
}

///
/// Render
///

type AutoRunOpts = IAutorunOptions & { keep?: boolean };

interface AutoRunConfig {
  functionName: string | symbol;
  options: AutoRunOpts;
}

type IRender = DecoratorFunc & OptionalDecoratorFunc<AutoRunOpts>;

export const render: IRender = function (...args: any[]) {
  if (args.length === 3) {
    render1(args[0], args[1], args[2]);
  } else {
    return render2(args[0]);
  }
};

const _pushToRenderList = (
  target: cc.Component,
  key: string | symbol,
  opts?: AutoRunOpts
) => {
  const renderFunctionList =
    observerProtoMapForAutoRun.has(target) === false
      ? observerProtoMapForAutoRun.set(target, []).get(target)
      : observerProtoMapForAutoRun.get(target);
  renderFunctionList.push({ functionName: key, options: opts });
};

const render1: DecoratorFunc = (
  target: cc.Component,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<() => void>
) => {
  _pushToRenderList(target, key);
};

const render2: OptionalDecoratorFunc<AutoRunOpts> = (opts?: AutoRunOpts) => {
  return (
    target: cc.Component,
    key: string,
    descriptor: TypedPropertyDescriptor<() => void>
  ) => {
    _pushToRenderList(target, key, opts);
  };
};

///
/// Reactor
///
type ReactionOpts = IReactionOptions & { keep?: boolean };

interface ReactionConfig {
  functionName: string | symbol;
  options: ReactionOpts;
}

interface ReactReturn<T> {
  expression: (r: IReactionPublic) => T;
  effect: (arg: T, r: IReactionPublic) => void;
  options?: ReactionOpts;
}

type IReactor = DecoratorFunc & OptionalDecoratorFunc<ReactionOpts>;

export const reactor: IReactor = function (...args: any[]) {
  if (args.length === 3) {
    reactor1(args[0], args[1], args[2]);
  } else {
    return reactor2(args[0]);
  }
};

const _pushToReactionList = (
  target: cc.Component,
  key: string | symbol,
  opts?: ReactionOpts
) => {
  const reactorFunctionList =
    observerProtoMapForReaction.has(target) === false
      ? observerProtoMapForReaction.set(target, []).get(target)
      : observerProtoMapForReaction.get(target);
  reactorFunctionList.push({ functionName: key, options: opts });
};

const reactor1: DecoratorFunc = (
  target: cc.Component,
  key: string | symbol,
  descriptor: TypedPropertyDescriptor<() => IReactionDisposer>
) => {
  _pushToReactionList(target, key);
};

const reactor2 = <T, O extends cc.Component>({
  expression,
  opts,
}: {
  expression: (r: IReactionPublic) => T;
  opts?: ReactionOpts;
}) => {
  return (
    target: O,
    key: string,
    descriptor: TypedPropertyDescriptor<(arg: T) => void>
  ) => {
    _pushToReactionList(target, key, opts);
    const _value = descriptor.value as (arg: T) => void;
    descriptor.value = function (this: O) {
      return reaction(expression.bind(this), _value.bind(this), {
        name: `${target.constructor.name}.${key}`,
      });
    };
  };
};

/**
 * 和 reactor1 搭配进行副作用操作
 */
export const react = function <T>(
  expression: (r: IReactionPublic) => T,
  effect: (arg: T, r: IReactionPublic) => void,
  options?: ReactionOpts
): ReactReturn<T> {
  return { expression, effect, options };
};
