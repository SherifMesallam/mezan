/// API base URL for the Mezan backend.
///
/// Set at build time via --dart-define. For production (e.g. iOS release):
///   flutter build ios --dart-define=MEZAN_API_URL=https://your-app.onrender.com
///
/// Default is localhost for local development. No trailing slash.
const String apiBaseUrl = String.fromEnvironment(
  'https://mezan-7w05.onrender.com',
  defaultValue: 'http://localhost:3000',
);
