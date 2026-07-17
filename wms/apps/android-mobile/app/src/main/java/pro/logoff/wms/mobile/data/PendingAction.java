package pro.logoff.wms.mobile.data;

import androidx.room.Entity;
import androidx.room.PrimaryKey;

@Entity(tableName = "pending_actions")
public class PendingAction {
    @PrimaryKey(autoGenerate = true) public long id;
    public String method;
    public String path;
    public String bodyJson;
    public String idempotencyKey;
    public long createdAt;
    public int attempts;
}
