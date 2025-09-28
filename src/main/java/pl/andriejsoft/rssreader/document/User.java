package pl.andriejsoft.rssreader.document;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;
import pl.andriejsoft.rssreader.document.model.ConfigItem;

import java.util.List;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "user")
public class User {

    @Id
    private String Id;

    @Builder.Default
    @Indexed(unique = true)
    private String uuid = UUID.randomUUID().toString();

    @Indexed(unique = true)
    private String userName;
}
