import PouchDB from "pouchdb";
import PouchfindDocs from "pouchdb-findDocs";
import { beautifulJSON } from "./beautifulJSON";
import {
  Observable,
  fromEvent,
  from,
  forkJoin,
  of,
  interval,
  combineLatest,
  throwError
} from "rxjs";
import {
  map,
  pluck,
  merge,
  mergeMap,
  catchError,
  timeout,
  bufferWhen,
  debounceTime,
  distinctUntilChanged,
  switchMap,
  concatMap,
  delay
} from "rxjs/operators";
import * as isNode from "detect-node";
import { v4 } from 'uuid';

export class rxPouch {
  private _remoteAddress: string;
  private _localName: string | undefined;
  private _remoteDB: any;
  private _localDB: any;
  private _allDocs$: any;
  private _changes$: Observable<any>;
  private _paused$: Observable<any>;
  private _syncUp: any;
  private _syncDown: any;
  private _syncCheck$: any;

  constructor(
    remoteCouchDB?: string,
    mangoIndex?: PouchDB.findDocs.CreateIndexOptions,
    mangoSelector?: PouchDB.findDocs.Selector
  ) {
    // hook up the pouchdb findDocs plugin (mango queries)
    PouchDB.plugin(PouchfindDocs);

    // use either the provided address or a default
    this._remoteAddress = remoteCouchDB || "http://localhost:5984/delete_me";

    // JS trickery to get last bit of URL
    // (which is the database name)
    let parts = this._remoteAddress.split("/");
    this._localName = parts.pop() || parts.pop(); // handle potential trailing slash

    // if this is running in NodeJS then put in subfolder
    // not essential just being tidy
    if (isNode) {
      this._localName = "pouchdb-data/" + this._localName;
    }

    this._remoteDB = new PouchDB(this._remoteAddress);
    this._localDB = new PouchDB(this._localName);

    if (mangoSelector) {
      this._localDB.createIndex(mangoIndex);
      this._localDB.findDocs({
        selector: mangoSelector
      });
      this._remoteDB.findDocs({
        selector: mangoSelector
      });
    }

    this._syncDown = PouchDB.replicate(this._remoteDB, this._localDB, {
      live: true,
      retry: true,
      selector: mangoSelector
    });

    this._syncUp = PouchDB.replicate(this._localDB, this._remoteDB, {
      live: true,
      retry: true,
      selector: mangoSelector
    });

    this._changes$ = fromEvent(
      this._localDB.changes({
        since: "now",
        live: true,
        include_docs: false
      }),
      "change"
    );

    // log replication errors
    fromEvent(this._syncUp, 'error')
      .pipe(
        merge(fromEvent(this._syncDown, 'error')),
        delay(5000),
      )
      .subscribe(x => console.log(beautifulJSON(x)));

    this._paused$ = fromEvent(this._syncUp, "paused").pipe(
      merge(this._changes$),
      merge(fromEvent(this._syncUp, "active")),
      merge(fromEvent(this._syncDown, "paused")),
      merge(fromEvent(this._syncDown, "active")),
      // on NodeJS the paused event doesnt fire
      // when remoteDB goes offline
      // so check every few secs
      merge(interval(5000)),
      // this also prevents febrile
      // firing from all of the listeners at once
      debounceTime(1000)
    );

    this._allDocs$ = (): Observable<any> => {
      return from(
        this._localDB.allDocs({
          include_docs: true,
          attachments: false
        })
      ).pipe(
        pluck("rows"),
        map(x => {
          // let y = x as Array<any>;
          return (x as Array<any>).map(z => z["doc"]).filter(a => a._id.substr(0, 2) !== "_d");
        })
      );
    };

    // check if local and remote database are online and in sync
    // returns -1 if offline, >0  for sync. (1 = 100%)
    // -2 is some other error returned by PouchDb info
    this._syncCheck$ = (): Observable<number | {}> => {
      // return of("the _ObservableSync has been triggeres");
      // return from(this._localDB.info());
      // if both objects exist then make a Promise from their info() methods
      return forkJoin(this._localDB.info(), this._remoteDB.info())
        .pipe(
          // in NodeJS _remoteDB.info will not complete promise if offline
          // treat anything that takes more than a second as offline
          timeout(1000),
          map(x => {
            const y = x as Array<any>;
            if (y[0].doc_count && y[1].doc_count) {
              return y[0].doc_count / y[1].doc_count;
            } else {
              return -1;
            }
          })
        )
        .pipe(catchError((error, caught) => of(-2)));
    };
  }

  get rxDocs(): Observable<any> {
    return this._changes$.pipe(
      // so that it fires once when subscribed to
      // then fires on _changes$ stream
      merge(of(0)),
      mergeMap(x => this._allDocs$()),
      distinctUntilChanged()
    );
  }

  get rxSync(): Observable<number | {}> {
    return this._paused$.pipe(
      // so that it fires once when subscribed to
      // then fires on paused$ stream
      merge(of(0)),
      mergeMap(x => this._syncCheck$()),
      distinctUntilChanged()
    );
  }

  get log(): Observable<{}> {
    // return a JSON object the current docs
    // and the current sync code
    // when either streams updates
    return combineLatest(this.rxDocs, this.rxSync).pipe(
      mergeMap(x => {
        let syncText = "";
        switch (true) {
          case x[1] < 0:
            syncText = "offline";
            break;
          case x[1] === 1:
            syncText = "online and in sync";
            break;
          case x[1] > 1:
            syncText = "uploading";
            break;
          default:
            syncText = "downloading";
            break;
        }
        return of<{}>({
          docs: x[0],
          "sync code": x[1].toString(),
          "sync description": syncText
        });
      })
    );
  }

  putDoc = (doc: any): Observable<any> => {
    if (!doc._id) { doc._id = v4(); }
    return from(this._localDB.put(JSON.parse(JSON.stringify(doc))))
  };

  getDoc = (_id: string): Observable<any> => {
    return from(this._localDB.get(_id))
  }

  deleteDoc = (_id: string): Observable<any> => {
    return this.getDoc(_id)
      .pipe(
        map(docToDelete => {
          if (!docToDelete.error) { docToDelete._deleted = true }
          return docToDelete;
        }),
        concatMap(docFlagged => this.putDoc(docFlagged))
      );
  }

  findDocs = (mango: {}): Observable<any> =>
    from(this._localDB.findDocs(mango))
      // just want the docs
      .pipe(pluck('docs'));

  createIndex = (mango: {}): Observable<any> =>
    from(this._localDB.createIndex(mango));
}