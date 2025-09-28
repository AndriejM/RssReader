package pl.andriejsoft.rssreader.document.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.enums.FieldType;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GroupItem {
    private String key;
    private String name;
    private FieldType type;
}
