begin;
perform pg_notify('pgrst', 'reload schema');
commit;
