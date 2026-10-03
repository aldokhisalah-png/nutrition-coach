// Supabase connection. The publishable (anon) key is public by design: it only lets a signed-in
// user reach their OWN rows, because row-level security checks auth.uid() on every row.
// Never put the service_role / secret key here.
window.NC_CONFIG = {
  supabaseUrl: 'https://mwlzmpyiendhvebkatfi.supabase.co',
  supabaseAnonKey: 'sb_publishable_6-Z4ivZdsmcOgtw3LyhXeg_IpiIpggI'
};
