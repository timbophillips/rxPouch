import PouchDB from "pouchdb";
import { beautifulJSON } from "./beautifulJSON";
import { Observable, fromEvent, from } from "rxjs";
import { map, pluck, merge, mergeMap } from "rxjs/operators";
import * as isNode from "detect-node";

class rxPouch {
  private _remoteAddress: string;
  private _localName: string | undefined;
  private _remoteDB: any;
  private _localDB: any;
  private _ObservableAllDocs: any;
  private _ObservableChanges: Observable<any>;
  private _ObservablePaused: Observable<any>;
  private _sync: any;

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

    this._sync = PouchDB.sync(this._remoteDB, this._localDB, {
      live: true,
      retry: true
    });

    this._ObservablePaused = fromEvent(this._sync, "paused");

    this._ObservableChanges = fromEvent(
      this._localDB.changes({
        since: "now",
        live: true,
        include_docs: false
      }),
      "change"
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
  }

  get rxDocs(): Observable<any> {
    return this._ObservableChanges.pipe(
      merge(this._ObservablePaused),
      mergeMap(x => this._ObservableAllDocs())
    );
  }
}


/// test code
let z = new rxPouch("http://localhost:5984/tim");
z.rxDocs.subscribe(x => {
  console.clear();
  console.log(beautifulJSON(x));
});
