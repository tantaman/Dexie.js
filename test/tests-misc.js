import Dexie from 'dexie';
import {module, stop, start, asyncTest, equal, ok} from 'QUnit';
import {resetDatabase, spawnedTest} from './dexie-unittest-utils';

const async = Dexie.async;

var db = new Dexie("TestIssuesDB");
db.version(1).stores({
    users: "id,first,last,&username,*&email,*pets",
    keyless: ",name",
    foo: "id"
    // If required for your test, add more tables here
});

module("misc", {
    setup: () => {
        stop();
        resetDatabase(db).catch(e => {
            ok(false, "Error resetting database: " + e.stack);
        }).finally(start);
    },
    teardown: () => {
    }
});

//
// Misc Tests
//

asyncTest("Adding object with falsy keys", function () {
    db.keyless.add({ name: "foo" }, 1).then(function (id) {
        equal(id, 1, "Normal case ok - Object with key 1 was successfully added.")
        return db.keyless.add({ name: "bar" }, 0);
    }).then(function (id) {
        equal(id, 0, "Could add a numeric falsy value (0)");
        return db.keyless.add({ name: "foobar" }, "");
    }).then(function (id) {
        equal(id, "", "Could add a string falsy value ('')");
        return db.keyless.put({ name: "bar2" }, 0);
    }).then(function (id) {
        equal(id, 0, "Could put a numeric falsy value (0)");
        return db.keyless.put({ name: "foobar2" }, "");
    }).then(function (id) {
        equal(id, "", "Could put a string falsy value ('')");
    }).catch(function (e) {
        ok(false, e);
    }).finally(start);
});

asyncTest("#102 Passing an empty array to anyOf throws exception", async(function* () {
    try {
        let count = yield db.users.where("username").anyOf([]).count();
        equal(count, 0, "Zarro items matched the query anyOf([])");
    } catch (err) {
        ok(false, "Error when calling anyOf([]): " + err);
    } finally {
        start();
    }
}));

spawnedTest("#248 'modifications' object in 'updating' hook can be bizarre", function*() {
    var numCreating = 0,
        numUpdating = 0;
    function CustomDate (realDate) {
        this._year = new Date(realDate).getFullYear();
        this._month = new Date(realDate).getMonth();
        this._day = new Date(realDate).getDate();
        this._millisec = new Date(realDate).getTime();
        //...
    }
    
    function creatingHook (primKey, obj) {
        ++numCreating;
        var date = obj.date;
        if (date && date instanceof CustomDate) {
            obj.date = new Date(date._year, date._month, date._day);
        }
    }
    function updatingHook (modifications, primKey, obj) {
        ++numUpdating;
        var date = modifications.date;
        if (date && date instanceof CustomDate) {
            return {date: new Date(date._year, date._month, date._day)};
        }
    }
    function readingHook (obj) {
        if (obj.date && obj.date instanceof Date) {
            obj.date = new CustomDate(obj.date);
        }
        return obj;
    }
    
    db.foo.hook('creating', creatingHook);
    db.foo.hook('reading', readingHook);
    db.foo.hook('updating', updatingHook);
    var testDate = new CustomDate(new Date(2016, 5, 11));
    equal(testDate._year, 2016, "CustomDate has year 2016");
    equal(testDate._month, 5, "CustomDate has month 5");
    equal(testDate._day, 11, "CustomDate has day 11");
    var testDate2 = new CustomDate(new Date(2016, 5, 12));
    try {
        db.foo.add ({id: 1, date: testDate});
        
        var retrieved = yield db.foo.get(1);
        
        ok(retrieved.date instanceof CustomDate, "Got a CustomDate object when retrieving object");
        equal (retrieved.date._day, 11, "The CustomDate is on day 11");
        db.foo.put ({id: 1, date: testDate2});
        
        retrieved = yield db.foo.get(1);
        
        ok(retrieved.date.constructor === CustomDate, "Got a CustomDate object when retrieving object");
        equal (retrieved.date._day, 12, "The CustomDate is now on day 12");
        
        // Check that hooks has been called expected number of times
        equal(numCreating, 1, "creating hook called once");
        equal(numUpdating, 1, "updating hook called once");
    } finally {
        db.foo.hook('creating').unsubscribe(creatingHook);
        db.foo.hook('reading').unsubscribe(readingHook);
        db.foo.hook('updating').unsubscribe(updatingHook);
    }
});

asyncTest("Issue: Broken Promise rejection #264", 1, function () {
    db.open().then(()=>{
        return db.users.where('id')
            .equals('does-not-exist')
            .first()
    }).then(function(result){
        return Promise.reject(undefined);
    }).catch(function (err) {
        equal(err, undefined, "Should catch the rejection");
    }).then(res => {
        start();
    }).catch(err => {
        start();
    });
});

spawnedTest("Issue #328 AbortError with bulkAdd since updating from 1.3.6 to 1.4.2", function* () {
    var resolveFinalPromise;
    var finalPromise = new Dexie.Promise(resolve => resolveFinalPromise = resolve);
    var later = function(cb) {
        return (function() {
            var a = arguments;

            setTimeout(function() {
                cb.apply(this, a);
            }.bind(this));
        }.bind(this));
    }.bind(this);
    var actions = [{id: 1}, {id: 2}];
    function callback (err, actions) {
        if (err) {
            ok(false, err.stack);
            resolveFinalPromise();
            return;
        }
        ok(true, "No error");
        resolveFinalPromise();
    }

    yield Dexie.Promise.all([
        
        finalPromise,
        db.foo.bulkAdd(actions).then(later(function() {
      return callback && callback(null, actions);
    })).catch('ConstraintError', function() {
        ok (false, "Got error: " + err.stack);
        return db.foo.put({id: 1, foo: 'bar'});
    }).catch('InvalidStateError', function() {
        ok (false, "Got error: " + err.stack);
        return callback && callback(null, actions);
    }).catch(function(err) {
        //this.exception('bulkAddActionForScore', err);
        ok (false, "Got error: " + err.stack);
        return callback && callback(err, actions);
    }.bind(this)), db.foo.add({id:1})]);
});
