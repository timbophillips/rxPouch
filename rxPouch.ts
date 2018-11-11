import PouchDB from "pouchdb";
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
  private _ObservableAllDocs: any;
  private _ObservableChanges: Observable<any>;
  private _ObservablePaused: Observable<any>;
  private _syncUp: any;
  private _syncDown: any;
  private _ObservableSync: any;

  constructor(remoteCouchDB?: string) {
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

    this._syncDown = PouchDB.replicate(this._remoteDB, this._localDB, {
      live: true,
      retry: true
    });

    this._syncUp = PouchDB.replicate(this._localDB, this._remoteDB, {
      live: true,
      retry: true
    });

    this._ObservableChanges = fromEvent(
      this._localDB.changes({
        since: "now",
        live: true,
        include_docs: false
      }),
      "change"
    );

    this._ObservablePaused = fromEvent(this._syncUp, "paused").pipe(
      merge(this._ObservableChanges),
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

    this._ObservableAllDocs = (): Observable<any> => {
      return from(
        this._localDB.allDocs({
          include_docs: true,
          attachments: true
        })
      ).pipe(
        pluck("rows"),
        map(x => {
          let y = x as Array<any>;
          return y.map(value => value["doc"]);
        })
      );
    };

    // check if local and remote database are online and in sync
    // returns -1 if offline, >0  for sync. (1 = 100%)
    // -2 is some other error returned by PouchDb info
    this._ObservableSync = (): Observable<number | {}> => {
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
    return this._ObservableChanges.pipe(
      merge(of(0)),
      mergeMap(x => this._ObservableAllDocs()),
      distinctUntilChanged()
    );
  }

  get rxSync(): Observable<number | {}> {
    return this._ObservablePaused.pipe(
      merge(of(0)),
      mergeMap(x => this._ObservableSync()),
      distinctUntilChanged()
    );
  }
}

/// test code
let z = new rxPouch("http://localhost:5984/tim");
console.log("started...");

// show the dosc and the sync code in the console
// when either streams update the console for both 
combineLatest(z.rxDocs, z.rxSync).subscribe(([docs, sync]) => {
  console.clear();
  console.log(beautifulJSON(docs));
  console.log("sync code: " + sync.toString());
});
