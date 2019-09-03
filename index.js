import { isObject, isFunction } from './index.js';

/** 基于Blob创建 Worker */
export function createWorkerByBlob(blob, options) {
  try{
    const URL = window.URL;
    const blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(blobUrl, options);
    worker._blobUrl = blobUrl;
    const _terminate = worker.terminate;
    worker.terminate = function(...args) {
      URL.revokeObjectURL(this._blobUrl);
      _terminate.apply(this, args);
    };
    return Promise.resolve(worker);
  }catch(e) {
    return Promise.reject(e);
  }
}

/**
 * @function createWorkerByUri
 * @description 通过地址创建 Worker（解决同域限制），如果是相对路径则直接创建，否则fetch拉取远程文件再创建。
 * @param  {String}   url 文件路径
 * @param  {Object}   worker options
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
const urlRegxp = /^((https?):)?\/\//;
export function createWorkerByUri(url, options) {
  if(urlRegxp.test(url)) {
    return fetch(url, {
      method: 'GET',
      headers: {},
      mode: 'cors'
    }).then(res => {
      if(res.status === 200) {
        return res.blob();
      }else {
        throw new Error(res);
      }
    }).then(blob => createWorkerByBlob(blob, options));
  } else {
    try{
      return Promise.resolve(new Worker(url, options));
    }catch(e) {
      return Promise.reject(e);
    }
  }
}

/**
 * @function createWorkerByTxt
 * @description 通过传入worker的JS脚本内容创建Worker。
 * @param  {String}   txt worker内容
 * @param  {Object}   options
 *     {Object}     globalArgs 全局参数
 *     {Function}   before 要附加在正文前面的worker内容
 *     {Function}   after  要附加在正文后面的worker内容
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
export function createWorkerByTxt(txt, options) {
  try{

    const before = options.before;
    delete options.before;
    if(before) txt = (isFunction(before) ? getFunBodyTxt(before) : before) + '\n\n' + txt;
    const after = options.after;
    delete options.after;
    if(after) txt += '\n\n' + (isFunction(after) ? getFunBodyTxt(after) : after);

    // 支持通过 globalArgs 预先设置全局变量
    const globalArgs = options.globalArgs;
    delete options.globalArgs;
    if(isObject(globalArgs)) {
      let argsCodes = '';
      Object.keys(globalArgs).forEach(argName => {
        argsCodes += 'self[' + JSON.stringify(argName) + '] = ' + JSON.stringify(globalArgs[argName]) + '; \n';
      });
      txt = argsCodes + txt;
    }
    return createWorkerByBlob(new Blob([txt], { type: 'application/javascript' }), options);
  }catch(e) {
    return Promise.reject(e);
  }
}

function getFunBodyTxt(fun) {
  return fun.toString().replace(/^[^{]+{/, '').replace(/}$/, '');
}

/**
 * @function createWorkerByFun
 * @description 通过传入一个包含Worker内容体的函数来创建web worker。
 * @param  {Function}   fun    包含worker内容的函数
 * @param  {Object}     options
 * @return {Promise}  成功结果为web worker 实例，失败则是异常信息
 */
export function createWorkerByFun(fun, options) {
  if(!isFunction(fun)) {
    throw new Error('createWorkerByFun 的第一个参数不是一个 function 。');
  }
  return createWorkerByTxt(getFunBodyTxt(fun), options);
}

/**
 * @class PromiseWorker
 * @description 一个通过Promise模式传递消息的Worker类
 *    使用本类的实例发送消息给worker必须使用类提供的postMsg方法，该方法可以得到一个Promise。
 *    worker内部的上下文实现里，需要使用 self.onMsgPromise 来接受处理消息，按失败或正常选择不同的回调resolve 或 reject。
 * @return {Class}
 */
export class PromiseWorker {

  // worker 要追加的封装实现
  static before = function() {

    /* 在init参数context传入的worker上下文环境封装规则：
     *   应该使用 self.onMsgPromise 接受外部信息，或者直接去写 self.methods 。
     *   并处理后按如下实现返回：
     */
    self.onMsgPromise = (req = {}, resolve, reject) => {
      const {type, data} = req;
      /* methods 命名空间下的方法要自己去按业务需求进行实现 */
      const methods = self.methods;;
      if(methods && methods[type]) {
        methods[type](data, resolve, reject);
      }else {
        // 没有消息中type对应的处理方法
        reject('[worker_fetch] 未知的webWork消息类型: ' + JSON.stringify(req));
      }
    };
    // 对于非外部信息的响应--要主动发回的消息，可以使用self.emit(type, data, transDatas)。
    self.emit = (type, data, ...args) => self.postMsg({type, data}, 1, undefined, ...args);

    // 封装消息发送方法，以统一消息格式
    self.postMsg = (res, ok = 1, _id, ...args) => {
      try{
        self.postMessage({ res, ok, _id }, args);
      } catch(err) {
        console.warn(err, res, args);
      }
    };

    // 劫持消息处理(worker上下文里应该使用onMsgPromise来接受并处理消息，且返回一个标准的Promise)
    // [注意] 使用本类后，worker上下文里不应该再重置掉 self.onmessage！
    self.onmessage = (evt = {}) => {
      const {req, _id} = evt.data || {};
      self.onMsgPromise(
        req,
        (res, ...transData) => self.postMsg(res, 1, _id, ...transData),
        (err, ...transData) => self.postMsg(err, 0, _id, ...transData)
      );
    };

    // 公共方法库：buffer合并
    self.mergeBuffer = (bufferArr = [], totalSize = 0) => {
      if(bufferArr.length === 1) return bufferArr[0];
      totalSize = totalSize || bufferArr.reduce((a, b) => a + b.byteLength, 0);
      const uint8arr = new Uint8Array(totalSize);
      let offset = 0;
      bufferArr.forEach(buf =>{
        uint8arr.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      });
      return uint8arr.buffer;
    };

  };
  // worker 要追加的封装实现
  static after = function() {
    // 确认worker就绪
    self.postMsg('ready by PromiseWorker.after');
  };

  /**
   * @constructor
   * @description 构造方法
   * @return {this}
   */
  constructor() {
    const _t = this;
    _t.killed = 0;
    // 计数器，用于记录消息ID，作为唯一标识
    _t._idx = 0;
    // 待返回信息后结束Promise的队列，格式 {_d: { data, resolve, reject }} 处理完毕会删除掉
    _t.queue = {};
    // worker 就绪前调用指令先缓存起来
    _t.cmdCache = [];
  }

  // 执行缓存的指令队列
  _runCmdCache(err) {
    const _t = this;
    const queue = _t.cmdCache;
    if(queue.length !== 0) {
      // 按次序逐个装载
      const _runCmd = () => {
        if(queue.length === 0) return;
        const [args, resolve, reject] = queue.shift();
        err === undefined ? _t.emit(...args).then(resolve, reject).finally(_runCmd) : reject(err);
      };
      _runCmd();
    }
  }

  /**
   * @Function
   * @description 初始化worker
   * @param  {Function}    context 要创建worker的代码内容
   * @param  {Object}      options Worker的配置参数
   * @return {this}
   */
  ready = false;
  init(context, options = {}) {
    const _t = this;

    // 接收处理被动（宿主没请求，worker主动发过来的）消息
    const methods = options.methods || {};
    delete options.methods;
    const onPassiveMsg = options.onPassiveMsg || function(res, ok, evtData) {
      const {type, data} = res || {};
      if(type && methods[type]) {
        methods[type](data);
      }else {
        console.warn('onPassiveMsg 未处理的worker发回信息:', evtData);
      }
    };
    delete options.onPassiveMsg;

    return new Promise((resolve, reject) => {
      options.before = PromiseWorker.before;
      options.after = PromiseWorker.after;
      // 创建worker实例，外层包一个 Promise 来解决需要等待内部ready确认是否成功。
      createWorkerByFun(context, options).then(worker => {
        // 内置初始化消息接受的逻辑
        const queue = _t.queue;

        // 处理返回的消息
        worker.onmessage = (evt = {}) => {
          if(_t.killed) return;
          const evtData = evt.data || {};
          const {res, ok, _id} = evtData;
          if(res === 'ready by PromiseWorker.after') {
            _t.ready = true;
            _t._runCmdCache();
            // 确保worker能正常工作才算创建成功
            return resolve(worker);
          }
          if(_id && queue[_id]) {
            // 处理消息回调
            queue[_id][+ok === 1 ? 'resolve' : 'reject'](res);
            delete queue[_id];
            return;
          }
          // queue中没有可处理收到消息的方法，那么都认为是worker主动发回的消息
          if(onPassiveMsg) {
            onPassiveMsg(res, ok, evtData);
          }else {
            console.warn('[PromiseWorker] Unprocessed messages: ', evtData);
          }
        };
        _t.worker = worker;
      }).catch(err => {
        _t._runCmdCache(err);
        reject(err);
      });
    });
  }
  /**
   * @Function
   * @description 发消息给webWorker，并得到一个对应的promise
   * @param  {Any}   type  type字段
   * @param  {Any}   data  data字段
   * @return {Promise}
   */
  emit(type, data, ...args) {
    const _t = this;
    return _t.ready ? this.postMsg({type, data}, ...args) : new Promise((resolve, reject) => {
      _t.cmdCache.push([[type, data, ...args], resolve, reject]);
    });
  }
  /**
   * @Function
   * @description 发消息给webWorker，并得到一个对应的promise
   * @param  {Any}   req  要发送给worker的数据
   * @return {Promise}
   */
  postMsg(req, ...args) {
    const _t = this;
    const queue = _t.queue;
    return new Promise((resolve, reject) => {
      const worker = _t.worker;
      _t._idx++;
      const _id = _t._idx.toString(36);
      try{
        worker.postMessage({_id, req}, args);
        queue[_id] = { req, resolve, reject, _t: +new Date()};
      }catch(e) {
        reject(e);
      }
    });
  }

  /**
   * @Function
   * @description 从待返回的Promise队列里删除符合筛选函数的排队者
   * @param  {Function}   filter(data, timestamp)  筛选器，接受2个参数：
   *         {Any}        req        要发送的数据
   *         {Number}     timestamp  发送消息时的时间戳（可用于做超时判断等）
   * @return {Promise}
   */
  remove(filter) {
    const queue = this.queue;
    Object.keys(queue).forEach(id => {
      const {req, _t, reject} = queue[id];
      if(filter(req, _t)) {
        reject('Abort by remove.');
        delete queue[id];
      }
    });
    return this;
  }

  // 销毁worker
  terminate() {
    const _t = this;
    if(_t.worker) {
      _t._idx = 0;
      _t.queue = {};
      _t.killed = 1;
      _t.worker.terminate();
    }
  }

};
