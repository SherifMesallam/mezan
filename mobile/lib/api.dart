import 'dart:convert';
import 'package:http/http.dart' as http;

import 'config.dart';

class Api {
  Api({String? baseUrl, this.token}) : baseUrl = baseUrl ?? apiBaseUrl;

  final String baseUrl;
  String? token;

  Map<String, String> get _headers {
    final h = {'Content-Type': 'application/json', 'Accept': 'application/json'};
    if (token != null) h['Authorization'] = 'Bearer $token';
    return h;
  }

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    final r = await http.post(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _handle(r);
  }

  Future<Map<String, dynamic>> get(String path, [Map<String, String>? queryParams]) async {
    var uri = Uri.parse('$baseUrl$path');
    if (queryParams != null && queryParams.isNotEmpty) {
      uri = uri.replace(queryParameters: queryParams);
    }
    final r = await http.get(uri, headers: _headers);
    return _handle(r);
  }

  Future<Map<String, dynamic>> patch(String path, Map<String, dynamic> body) async {
    final r = await http.patch(
      Uri.parse('$baseUrl$path'),
      headers: _headers,
      body: jsonEncode(body),
    );
    return _handle(r);
  }

  Future<Map<String, dynamic>> delete(String path) async {
    final r = await http.delete(Uri.parse('$baseUrl$path'), headers: _headers);
    if (r.statusCode == 204) return {};
    return _handle(r);
  }

  static Future<Map<String, dynamic>> _handle(http.Response r) async {
    final body = r.body.isEmpty ? <String, dynamic>{} : jsonDecode(r.body) as Map<String, dynamic>;
    if (r.statusCode >= 200 && r.statusCode < 300) return body;
    throw ApiException(r.statusCode, body['error'] as String? ?? r.body);
  }
}

class ApiException implements Exception {
  ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  @override
  String toString() => 'ApiException($statusCode): $message';
}
