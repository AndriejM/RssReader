package pl.andriejsoft.rssreader.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import pl.andriejsoft.rssreader.entity.converter.JpaUserConfigConverter;
import pl.andriejsoft.rssreader.entity.model.UserConfigPayload;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "user_config")
public class UserConfigEntity {

  @Id
  @GeneratedValue(strategy = GenerationType.AUTO, generator = "global_sequence")
  @SequenceGenerator(name = "global_sequence", sequenceName = "global_sequence", allocationSize = 1)
  private Long id;

  @Convert(converter = JpaUserConfigConverter.class)
  @Column(name = "user_config_payload", insertable = true, updatable = true, nullable = true, columnDefinition = "json")
  private UserConfigPayload userConfigPayload;

  @Column(name = "user_name")
  private String userName;
}