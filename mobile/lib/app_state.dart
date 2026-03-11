import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

class AppState extends ChangeNotifier {
  String? _token;
  String? get token => _token;

  String? _ingestToken;
  String? get ingestToken => _ingestToken;

  String? _baseUrl;
  String? get baseUrl => _baseUrl;
  String get effectiveBaseUrl => _baseUrl ?? 'http://localhost:3000';

  bool _isLoading = true;
  bool get isLoading => _isLoading;

  static const _keyToken = 'mezan_token';
  static const _keyIngestToken = 'mezan_ingest_token';
  static const _keyBaseUrl = 'mezan_base_url';

  AppState() {
    _load();
  }

  Future<void> _load() async {
    final prefs = await SharedPreferences.getInstance();
    _token = prefs.getString(_keyToken);
    _ingestToken = prefs.getString(_keyIngestToken);
    _baseUrl = prefs.getString(_keyBaseUrl);
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

  Future<void> setBaseUrl(String? url) async {
    _baseUrl = url?.trim().isEmpty == true ? null : url;
    final prefs = await SharedPreferences.getInstance();
    if (_baseUrl != null) {
      await prefs.setString(_keyBaseUrl, _baseUrl!);
    } else {
      await prefs.remove(_keyBaseUrl);
    }
    notifyListeners();
  }

  Future<void> logout() async {
    await setToken(null);
  }
}
