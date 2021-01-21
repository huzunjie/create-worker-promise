# 基于 Promise 异步创建 web worker

主要支持以下创建 web worker 场景：

* 同源相对路径创建或从远程URI拿 worker 执行内容
* 通过传入一个可执行的文本内容创建
* 通过一个函数包装创建worker实例

主要解决通过 Promise 解决对称通讯，及异步行为结果返回的需求。
