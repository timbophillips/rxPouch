import PouchDB from "pouchdb";
import PouchFind from "pouchdb-find";
import { beautifulJSON } from "./beautifulJSON";
import {
  Observable,
  fromEvent,
  from,
  forkJoin,
  of,
  interval,
  combineLatest
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
  distinctUntilChanged
} from "rxjs/operators";
import * as isNode from "detect-node";

class rxPouch {
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
    mangoIndex?: PouchDB.Find.CreateIndexOptions,
    mangoSelector?: PouchDB.Find.Selector
  ) {
    // hook up the pouchdb find plugin (mango queries)
    PouchDB.plugin(PouchFind);

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
      console.log("index done");
      this._localDB.find({
        selector: mangoSelector
      });
      this._remoteDB.find({
        selector: mangoSelector
      });
      console.log(mangoIndex + " | " + mangoSelector);
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
    fromEvent(this._syncUp, 'error').pipe(merge(fromEvent(this._syncDown, 'error'))).subscribe(x => console.log(beautifulJSON(x)));

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
          let y = x as Array<any>;
          return y.map(z => z["doc"]).filter(a => a._id.substr(0, 2) !== "_d");
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
            // console.log("=====internal=====")
            // console.log(beautifulJSON(y[0]));
            // console.log("=====external=====")
            // console.log(beautifulJSON(y[1]));
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
    return combineLatest(z.rxDocs, z.rxSync).pipe(
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
}

/// test code

// instantiate the class
console.log("new rxPouch.... which I think must be synchronous code");
let z = new rxPouch(
  "http://localhost:5984/tasks",
  // { index: { fields: ["patient_name"] } },
  // { patient_name: "uuuusss" }
);
console.log("started...");

z.log.subscribe(x => {
  console.clear();
  console.log(beautifulJSON(x));
});
