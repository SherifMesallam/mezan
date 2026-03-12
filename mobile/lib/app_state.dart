import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';
import 'config.dart';

class AppState extends ChangeNotifier {
  String? _token;
  String? get token => _token;

  String? _ingestToken;
  String? get ingestToken => _ingestToken;

  /// API base URL from app config (build-time dart-define). Not user-editable.
  String get effectiveBaseUrl => apiBaseUrl;

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  static const _keyToken = 'mezan_token';
  static const _keyIngestToken = 'mezan_ingest_token';

  AppState() {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(_keyToken);
    _ingestToken = prefs.getString(_keyIngestToken);
    _isLoading = false;
    notifyListeners();
  }

  Future<void> setToken(String? t) async {
    _token = t;
    final prefs = await SharedPreferences.getInstance();
    if (t != null) {
      await prefs.setString(_keyToken, t);
    } else {
      await prefs.remove(_keyToken);
      await prefs.remove(_keyIngestToken);
      _ingestToken = null;
    }
    notifyListeners();
  }

  Future<void> setIngestToken(String? t) async {
    _ingestToken = t;
    final prefs = await SharedPreferences.getInstance();
    if (t != null) {
      await prefs.setString(_keyIngestToken, t);
    } else {
      await prefs.remove(_keyIngestToken);
    }
    notifyListeners();
  }

  Future<void> logout() async {
    await setToken(null);
  }
}
