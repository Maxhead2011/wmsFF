-- TEST: use only an isolated empty PostgreSQL database, never a production schema.
INSERT INTO "ClientRequest"(id) VALUES ('r1'),('r2'),('r3');
INSERT INTO "ClientMarketplaceConnection"(id) VALUES ('a');
INSERT INTO "YandexFbyShipment"("id","requestId","connectionId","importKey","remoteId","updatedAt") VALUES ('s1','r1','a','key1','remote',now());
DO $$ BEGIN
 BEGIN
  INSERT INTO "YandexFbyShipment"("id","requestId","connectionId","importKey","remoteId","updatedAt") VALUES ('s2','r2','a','key2','remote',now());
  RAISE EXCEPTION 'duplicate supply accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO "YandexFbyShipment"("id","requestId","connectionId","importKey","updatedAt") VALUES ('s3','r2','a','key1',now());
  RAISE EXCEPTION 'duplicate import key accepted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO "YandexFbyShipment"("id","requestId","connectionId","importKey","updatedAt") VALUES ('s4','foreign','a','key4',now());
  RAISE EXCEPTION 'foreign request accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
INSERT INTO "YandexFbyShipment"("id","requestId","connectionId","importKey","updatedAt") VALUES ('s2','r2','a','key2',now()),('s3','r3','a','key3',now());
DELETE FROM "ClientRequest" WHERE id='r1';
DO $$ BEGIN
 IF (SELECT count(*) FROM "YandexFbyShipment") <> 2 THEN RAISE EXCEPTION 'cascade failed'; END IF;
END $$;
