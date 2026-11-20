Attribute VB_Name = "TimeCapture"
'==============================================================================
' TimeCapture - Registra la asistencia a una cita en Time Capture (Eficacia)
' llamando directamente a la API que usa el complemento:
'   POST /findAppointmentAttendee  -> busca si ya existe un registro (uuid)
'   POST /data/attendee            -> crea / actualiza el registro
'
' Uso: abre o selecciona la cita (o la convocatoria) y ejecuta DiligenciarTimeCapture.
'==============================================================================
Option Explicit

Private Const API_BASE As String = "https://tc.eficacia.com.co:7000/api"

' Valores por defecto: se usan si la cita no trae el dato en el formulario "Corporativo".
Private Const DEF_PAIS As String = "COLOMBIA"
Private Const DEF_GERENCIA As String = "Soluciones De Desarrollo Comercial"
Private Const DEF_PROCESO As String = "Inteligencia & Analitica Comercial"
Private Const DEF_NEGOCIO As String = "Soluciones De Desarrollo Comercial"
Private Const DEF_CLIENTE As String = "Colgate Palmolive Compañia"   ' varios: "A|B"

' Nombres de los campos del formulario "Corporativo" (UserProperties de la cita).
' Ajusta si en tu formulario se llaman distinto.
Private Const FLD_NEGOCIO As String = "Negocio"
Private Const FLD_PROCESO As String = "Proceso"
Private Const FLD_GERENCIA As String = "Gerencia"
Private Const FLD_CLIENTE As String = "Cliente"

Public Sub DiligenciarTimeCapture()
    Dim cita As Outlook.AppointmentItem
    Set cita = ObtenerCitaActual()
    If cita Is Nothing Then
        MsgBox "Abre o selecciona una cita del calendario.", vbExclamation, "Time Capture"
        Exit Sub
    End If

    ' --- Datos de la cita (igual que los arma el complemento) ---
    Dim titulo As String, organizador As String, asistentes As String
    Dim miCorreo As String, categorias As String
    titulo = cita.Subject
    organizador = LCase$(CorreoOrganizador(cita))
    asistentes = LCase$(CorreosRequeridos(cita))
    miCorreo = LCase$(SmtpDe(Application.Session.CurrentUser.AddressEntry))
    categorias = CategoriasJson(cita.Categories)

    Dim fIni As String, hIni As String, fFin As String, hFin As String
    fIni = Format$(cita.Start, "yyyy-mm-dd"): hIni = Format$(cita.Start, "hh:nn:ss")
    fFin = Format$(cita.End, "yyyy-mm-dd"):   hFin = Format$(cita.End, "hh:nn:ss")
    Dim tiempo As String
    tiempo = Format$(cita.Start, "hh:nn") & " - " & Format$(cita.End, "hh:nn")

    ' --- Clasificación: formulario Corporativo o valores por defecto ---
    Dim pais As String, gerencia As String, proceso As String, negocio As String, cliente As String
    pais = DEF_PAIS
    gerencia = CampoCita(cita, FLD_GERENCIA, DEF_GERENCIA)
    proceso = CampoCita(cita, FLD_PROCESO, DEF_PROCESO)
    negocio = CampoCita(cita, FLD_NEGOCIO, DEF_NEGOCIO)
    cliente = CampoCita(cita, FLD_CLIENTE, DEF_CLIENTE)

    ' --- ¿Ya existe un registro para esta cita? ---
    Dim jsonBuscar As String, respuesta As String, uuid As String
    jsonBuscar = "{" & _
        JPar("title", titulo) & "," & JPar("sender", organizador) & "," & _
        JPar("start_date", fIni) & "," & JPar("end_date", fFin) & "," & _
        JPar("start_time", hIni) & "," & JPar("end_time", hFin) & "," & _
        JPar("asistenteEmail", miCorreo) & "}"
    If Not PostJson(API_BASE & "/findAppointmentAttendee", jsonBuscar, respuesta) Then
        MsgBox "No se pudo consultar Time Capture:" & vbCrLf & respuesta, vbCritical, "Time Capture"
        Exit Sub
    End If
    uuid = ValorJson(respuesta, "uuid")

    ' --- Confirmación ---
    Dim resumen As String
    resumen = "Cita: " & titulo & vbCrLf & _
              "Fecha: " & fIni & "  " & tiempo & vbCrLf & vbCrLf & _
              "País: " & pais & vbCrLf & "Gerencia: " & gerencia & vbCrLf & _
              "Proceso: " & proceso & vbCrLf & "Negocio: " & negocio & vbCrLf & _
              "Cliente: " & cliente & vbCrLf & vbCrLf & _
              IIf(uuid = "", "Se CREARÁ un registro nuevo.", "Ya existe un registro: se ACTUALIZARÁ.") & _
              vbCrLf & vbCrLf & "¿Guardar en Time Capture?"
    If MsgBox(resumen, vbQuestion + vbYesNo, "Time Capture") <> vbYes Then Exit Sub

    ' --- Guardar ---
    Dim jsonGuardar As String
    jsonGuardar = "{" & _
        JPar("country", pais) & "," & JPar("client", cliente) & "," & _
        JPar("gerencia", gerencia) & "," & JPar("negocio", negocio) & "," & _
        JPar("proceso", proceso) & "," & JPar("title", titulo) & "," & _
        JPar("sender", organizador) & "," & JPar("attendees", asistentes) & "," & _
        JPar("start_date", fIni) & "," & JPar("start_time", hIni) & "," & _
        JPar("end_date", fFin) & "," & JPar("end_time", hFin) & "," & _
        JPar("categories", categorias) & "," & _
        """uuid"":" & IIf(uuid = "", "null", """" & JEsc(uuid) & """") & "," & _
        JPar("asistenteEmail", miCorreo) & "," & JPar("tiempoAsistencia", tiempo) & "}"

    If PostJson(API_BASE & "/data/attendee", jsonGuardar, respuesta) Then
        MsgBox "Registro guardado en Time Capture." & vbCrLf & vbCrLf & respuesta, vbInformation, "Time Capture"
    Else
        MsgBox "Error al guardar:" & vbCrLf & respuesta, vbCritical, "Time Capture"
    End If
End Sub

'------------------------------------------------------------------------------
' Cita abierta o seleccionada (acepta también la convocatoria de la bandeja)
'------------------------------------------------------------------------------
Private Function ObtenerCitaActual() As Outlook.AppointmentItem
    Dim obj As Object
    On Error Resume Next
    If TypeName(Application.ActiveWindow) = "Inspector" Then
        Set obj = Application.ActiveInspector.CurrentItem
    ElseIf Application.ActiveExplorer.Selection.Count > 0 Then
        Set obj = Application.ActiveExplorer.Selection(1)
    End If
    On Error GoTo 0
    If obj Is Nothing Then Exit Function

    If TypeOf obj Is Outlook.AppointmentItem Then
        Set ObtenerCitaActual = obj
    ElseIf TypeOf obj Is Outlook.MeetingItem Then
        Set ObtenerCitaActual = obj.GetAssociatedAppointment(False)
    End If
End Function

'------------------------------------------------------------------------------
' Correos
'------------------------------------------------------------------------------
Private Function SmtpDe(ae As Outlook.AddressEntry) As String
    On Error Resume Next
    If ae Is Nothing Then Exit Function
    If ae.AddressEntryUserType = olExchangeUserAddressEntry Or _
       ae.AddressEntryUserType = olExchangeRemoteUserAddressEntry Then
        SmtpDe = ae.GetExchangeUser.PrimarySmtpAddress
    End If
    If SmtpDe = "" Then
        SmtpDe = ae.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x39FE001E")
    End If
    If SmtpDe = "" Then SmtpDe = ae.Address
End Function

Private Function CorreoOrganizador(cita As Outlook.AppointmentItem) As String
    Dim ae As Outlook.AddressEntry
    On Error Resume Next
    Set ae = cita.GetOrganizer
    On Error GoTo 0
    If ae Is Nothing Then
        CorreoOrganizador = SmtpDe(Application.Session.CurrentUser.AddressEntry)
    Else
        CorreoOrganizador = SmtpDe(ae)
    End If
End Function

Private Function CorreosRequeridos(cita As Outlook.AppointmentItem) As String
    Dim r As Outlook.Recipient, lista As String
    For Each r In cita.Recipients
        If r.Type = olRequired Then
            If lista <> "" Then lista = lista & ","
            lista = lista & SmtpDe(r.AddressEntry)
        End If
    Next
    CorreosRequeridos = lista
End Function

'------------------------------------------------------------------------------
' Campos del formulario Corporativo
'------------------------------------------------------------------------------
Private Function CampoCita(cita As Outlook.AppointmentItem, nombre As String, porDefecto As String) As String
    Dim up As Outlook.UserProperty
    On Error Resume Next
    Set up = cita.UserProperties.Find(nombre)
    On Error GoTo 0
    If Not up Is Nothing Then CampoCita = Trim$(CStr(up.Value))
    If CampoCita = "" Then CampoCita = porDefecto
End Function

'------------------------------------------------------------------------------
' HTTP / JSON
'------------------------------------------------------------------------------
Private Function PostJson(url As String, cuerpo As String, ByRef respuesta As String) As Boolean
    Dim http As Object
    On Error GoTo Fallo
    Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
    http.Open "POST", url, False
    http.setRequestHeader "Content-Type", "application/json; charset=utf-8"
    http.Send cuerpo
    respuesta = http.responseText
    PostJson = (http.Status >= 200 And http.Status < 300)
    If Not PostJson Then respuesta = "HTTP " & http.Status & ": " & respuesta
    Exit Function
Fallo:
    respuesta = Err.Description
End Function

' Convierte "Cat1, Cat2" en el texto JSON ["Cat1","Cat2"] (el complemento lo envía así, como texto)
Private Function CategoriasJson(cats As String) As String
    Dim partes() As String, i As Long, s As String
    If Trim$(cats) = "" Then CategoriasJson = "[]": Exit Function
    partes = Split(cats, ",")
    For i = LBound(partes) To UBound(partes)
        If s <> "" Then s = s & ","
        s = s & """" & JEsc(Trim$(partes(i))) & """"
    Next
    CategoriasJson = "[" & s & "]"
End Function

Private Function JPar(clave As String, valor As String) As String
    JPar = """" & clave & """:""" & JEsc(valor) & """"
End Function

Private Function JEsc(ByVal s As String) As String
    s = Replace(s, "\", "\\")
    s = Replace(s, """", "\""")
    s = Replace(s, vbCrLf, "\n")
    s = Replace(s, vbCr, "\n")
    s = Replace(s, vbLf, "\n")
    s = Replace(s, vbTab, "\t")
    JEsc = s
End Function

' Extrae un valor de texto simple de un JSON plano: "clave":"valor"
Private Function ValorJson(json As String, clave As String) As String
    Dim p As Long, q As Long
    p = InStr(1, json, """" & clave & """:""", vbTextCompare)
    If p = 0 Then Exit Function
    p = p + Len(clave) + 4
    q = InStr(p, json, """")
    If q > p Then ValorJson = Mid$(json, p, q - p)
End Function
