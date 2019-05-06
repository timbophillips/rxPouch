/// <reference types="pouchdb-find" />
import { Observable } from "rxjs";
export declare class RxPouch {
    private _remoteAddress;
    private _localName;
    private _remoteDB;
    private _localDB;
    private _changes$;
    private _paused$;
    private _syncUp;
    private _syncDown;
    constructor(remoteCouchDB?: string, localCouchDBName?: string, mangoIndex?: PouchDB.Find.CreateIndexOptions, mangoSelector?: PouchDB.Find.Selector);
    private _view$;
    private _allDocs$;
    private fixAttachment;
    private _syncCheck$;
    rxView: (design_view_name: string) => Observable<any>;
    readonly rxDocs: Observable<any>;
    readonly rxSync: Observable<number | {}>;
    readonly log: Observable<{}>;
    putDoc: (doc: any) => Observable<any>;
    getDoc: (_id: string) => Observable<any>;
    deleteDoc: (_id: string) => Observable<any>;
    findDocs: (mango: PouchDB.Find.FindRequest<{}>) => Observable<any>;
    createIndex: (mango: PouchDB.Find.CreateIndexOptions) => Observable<any>;
}
