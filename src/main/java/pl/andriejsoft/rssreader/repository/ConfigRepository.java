package pl.andriejsoft.rssreader.repository;

import org.springframework.data.mongodb.repository.MongoRepository;
import pl.andriejsoft.rssreader.document.Config;

import java.util.Optional;

public interface ConfigRepository extends MongoRepository<Config, String> {
    Optional<Config> findByUuid(String uuid);

    Config deleteByUuid(String uuid);
}
