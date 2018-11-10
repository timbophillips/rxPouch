import PouchDB from 'pouchdb';
import { beautifulJSON } from "./beautifulJSON";
import { Observable, BehaviorSubject, fromEvent, from, forkJoin, of } from 'rxjs';
import { map, catchError, pluck, mergeMap } from 'rxjs/operators';

const local = new PouchDB('tasks');
const remote = new PouchDB('http://localhost:5984/tasks');

PouchDB.sync(local, remote, {
    live: true,
    retry: true
});

// must be an anonymous function so that
// it is fired as a callback when called
const ObsAllDocs = (): Observable<any> => {
    return from(local.allDocs({
        include_docs: true,
        attachments: true
    }))
        .pipe( 
            pluck("rows"),
            map(x => {
                let y = x as Array<any>;
                return y.map(value => value["doc"])
            },
            ))
}

const ObservableChanges: Observable<any> = fromEvent(local.changes({
    since: 'now',
    live: true,
    include_docs: false
}), 'change')


const ObservableLiveDocs = ObservableChanges
    .pipe(
        mergeMap(x => ObsAllDocs()),
    );

ObservableLiveDocs
    .subscribe(x => {
        console.clear()
        console.log(beautifulJSON(x))
    });

//kickoff
ObsAllDocs().subscribe(x => console.log(beautifulJSON(x)));