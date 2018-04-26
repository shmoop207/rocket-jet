import {IOptions} from "./IOptions";
import {Methods, Router} from 'appolo-route';
import {createRequest, IRequest} from "./request";
import {createResponse, IResponse} from "./response";
import {HttpError} from "./httpError";
import {Util} from "./util";
import {MiddlewareHandler, MiddlewareHandlerAny, MiddlewareHandlerParams, NextFn} from "./types";
import {ErrorHandler} from "./errorHandler";
import {Server} from "./server";
import {handleMiddleware} from "./middleware";
import {View} from "./view";
import {IApp} from "./IApp";
import    http = require('http');
import    https = require('https');
import    _ = require('lodash');
import    url = require('url');
import    qs = require('qs');
import    Q = require('bluebird');
import    querystring = require('querystring');

export class Agent implements IApp {

    private _middlewares: MiddlewareHandler[];
    private _server: http.Server | https.Server;
    private _router: Router;
    private _view: View;
    private _options: IOptions;
    private _qsParse: (path: string) => any;
    private _urlParse: (path: string) => ({ query: string, pathname?: string });
    private _requestApp: IApp

    protected readonly Defaults: IOptions = {
        errorStack: false,
        errorMessage: true,
        maxRouteCache: 10000,
        useRouteCache: true,
        decodeUrlParams: false,
        qsParser: "qs",
        urlParser: "fast",
        viewExt: "html",
        viewEngine: null,
        viewFolder: ""
    };

    public constructor(options?: IOptions) {

        this._options = _.defaults(options || {}, this.Defaults);

        this._qsParse = this._options.qsParser === "qs" ? qs.parse : querystring.parse;
        this._urlParse = this._options.urlParser === "fast" ? Util.parseUrlFast : url.parse;

        this._middlewares = [];

        this._router = new Router({
            useCache: this._options.useRouteCache,
            maxCacheSize: this._options.maxRouteCache,
            decodeUrlParams: this._options.decodeUrlParams
        });

        this._view = new View(this._options);

        this._server = Server.createServer(this);

        this._requestApp = this;
    }

    private _initialize() {
        this._middlewares.push(this._initRoute);
    }

    public set requestApp(app: IApp) {
        this._requestApp = app;
    }


    public handle = (request: http.IncomingMessage, response: http.ServerResponse) => {
        let req: IRequest = createRequest(request),
            res: IResponse = createResponse(request, response);

        try {
            this._initRequest(req, res);

            handleMiddleware(req, res, 0, this._middlewares);

        } catch (e) {
            ErrorHandler.handleError(e, res);
        }
    };

    private _initRequest(req: IRequest, res: IResponse): void {

        let {query, pathname} = this._urlParse(req.url);

        req.query = query.length ? this._qsParse(query) : {};
        req.pathName = pathname;
        req.originUrl = req.url;
        req.app = this._requestApp;
    }

    private _initRoute = (req: IRequest, res: IResponse, next: NextFn): void => {

        let route = this._router.find(req.method as Methods, req.pathName);

        if (!route) {
            next(new HttpError(404, `Cannot ${req.method} ${req.pathName}`));
            return;
        }

        req.params = route.params;
        req.route = route.handler.route;
        handleMiddleware(req, res, 0, route.handler.handlers);
    }

    public render(path: string | string[], params?: any,res?:IResponse): Promise<string> {
        let paths = _.isArray(path) ? path : [path];

        return this._view.render(paths, params,res)
    }

    public get options(): IOptions {
        return this._options;
    }

    public get(path: string, ...handler: MiddlewareHandlerParams[]): this {

        return this.add(Methods.GET, path, handler);
    }

    public post(path: string, ...handler: MiddlewareHandlerParams[]): this {
        return this.add(Methods.POST, path, handler);
    }

    public put(path: string, ...handler: MiddlewareHandlerParams[]): this {
        return this.add(Methods.PUT, path, handler);
    }

    public patch(path: string, ...handler: MiddlewareHandlerParams[]): this {
        return this.add(Methods.PATCH, path, handler);
    }

    public delete(path: string, ...handler: MiddlewareHandlerParams[]): this {
        return this.add(Methods.DELETE, path, handler);
    }

    public head(path: string, ...handler: MiddlewareHandlerParams[]): this {
        return this.add(Methods.HEAD, path, handler);
    }

    public add(method: keyof typeof Methods, path: string, handlers: MiddlewareHandlerParams[], route?: any): this {

        let dtoHandlers = _(handlers).map(handler => _.isArray(handler) ? handler : [handler]).flatten().value();

        this._router.add(method, path, {handlers: dtoHandlers, route});
        if (method != Methods.HEAD) {
            this._router.add(Methods.HEAD, path, {handlers: dtoHandlers, route});
        }
        return this;
    }

    public use(fn: MiddlewareHandler | MiddlewareHandlerAny): this {
        this._middlewares.push(fn);

        return this
    }

    public get server(): http.Server | https.Server {
        return this._server
    }

    public get router(): Router {
        return this._router;
    }

    public async close(): Promise<void> {
        try {
            await Q.fromCallback(c => this._server.close(c));
        } catch (e) {
            if (e.code !== "ERR_SERVER_NOT_RUNNING") {
                throw e;
            }
        }
    }

    public async listen(port: number, cb?: Function): Promise<Agent> {
        this._initialize();

        await Q.fromCallback(c => this._server.listen(port, c));

        (cb) && cb(this);

        return this;
    }
}