package pl.andriejsoft.rssreader.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.entity.converter.JpaConfigConverter;
import pl.andriejsoft.rssreader.entity.model.ConfigPayload;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "config")
public class ConfigEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO, generator = "global_sequence")
    @SequenceGenerator(name = "global_sequence", sequenceName = "global_sequence", allocationSize = 1)
    private Long id;

    @Convert(converter = JpaConfigConverter.class)
    @Column(name = "config_payload", insertable = true, updatable = true, nullable = true, columnDefinition = "json")
    private ConfigPayload configPayload;

    @Column(name = "user_id")
    private Long userId;
}
